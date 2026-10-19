//! Finding out what went wrong on a staff member's computer.
//!
//! Everything logged goes to a log file in the OS's logs folder (macOS:
//! `~/Library/Logs/in.prepwisely.app`, Windows:
//! `%LOCALAPPDATA%\in.prepwisely.app\logs`). Panics, frontend crashes and
//! anything logged as an error also go to Sentry, with the log lines before
//! them as breadcrumbs.
//!
//! Nothing personal is sent: the home folder in any path becomes `~` (its name
//! is often the person's real name) and the computer's name is dropped.

use std::time::Duration;

use log::LevelFilter;
use sentry::integrations::log::{LogFilter, SentryLogger};
use sentry::protocol::Event;
use sentry::{Breadcrumb, ClientInitGuard, ClientOptions};
use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy, WEBVIEW_TARGET};

/// prepwisely's Sentry project. Not a secret: it can only send reports.
const DSN: &str =
    "https://81d6cf144eb114f1c83edc1d3b4883ed@o4512011940200448.ingest.de.sentry.io/4512275892338768";

/// Log target for the log file only, never Sentry: for messages that may
/// name someone's files, e.g. `log::warn!(target: reporting::LOCAL, …)`.
pub const LOCAL: &str = "local";

/// Log target for panics: they go to the log file here, and to Sentry from
/// Sentry's own panic hook, so the logger mustn't send them a second time.
const PANIC_TARGET: &str = "panic";

/// Starts Sentry, which also reports panics from here on. Call it first, and
/// keep the guard for as long as the app runs. `version` is the app's version
/// from tauri.conf.json (Cargo.toml's isn't bumped on release).
pub fn init_sentry(version: &str) -> ClientInitGuard {
    let options = ClientOptions::new()
        .dsn(DSN)
        .release(format!("prepwisely@{version}"))
        .environment(if cfg!(debug_assertions) { "development" } else { "production" })
        // No IP addresses or request headers.
        .send_default_pii(false)
        .before_send(|event: Event<'static>| {
            let mut event = scrub(event);
            event.server_name = None;
            Some(event)
        })
        .before_breadcrumb(|breadcrumb: Breadcrumb| Some(scrub(breadcrumb)));
    sentry::init(options)
}

/// Starts the log file, and passes what Rust logs on to Sentry: errors as
/// reports, info and warnings as breadcrumbs. Panics are logged too. Call it
/// in `setup`, since the log folder comes from the app.
pub fn init_logging<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let mut builder = tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: Some("prepwisely".into()) }))
        // Our own records and the frontend's; only warnings from libraries.
        .level(LevelFilter::Warn)
        .level_for("prepwisely_lib", LevelFilter::Info)
        .level_for(WEBVIEW_TARGET, LevelFilter::Info)
        .level_for(LOCAL, LevelFilter::Info)
        .level_for(PANIC_TARGET, LevelFilter::Error)
        .max_file_size(2_000_000)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .timezone_strategy(TimezoneStrategy::UseLocal);
    if cfg!(debug_assertions) {
        builder = builder.target(Target::new(TargetKind::Stdout));
    }
    let (plugin, max_level, file) = builder.split(app)?;

    let logger = SentryLogger::with_dest(file).filter(|metadata| {
        // The frontend's Sentry reports its own records, and Sentry's panic
        // hook reports panics.
        let target = metadata.target();
        if target.starts_with(WEBVIEW_TARGET) || target == PANIC_TARGET || target == LOCAL {
            LogFilter::Ignore
        } else if target.starts_with("tauri_plugin_updater") {
            // A failed update check is usually the network.
            LogFilter::Breadcrumb
        } else {
            sentry::integrations::log::default_filter(metadata)
        }
    });
    log::set_boxed_logger(Box::new(logger))?;
    log::set_max_level(max_level);
    app.plugin(plugin)?;

    // Runs before Sentry's hook (set by init_sentry), which reports the panic.
    let report = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!(target: PANIC_TARGET, "{info}");
        report(info);
    }));

    log::info!(
        "prepwisely {} started on {} {}",
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    Ok(())
}

/// Sends what's still queued, as the app exits.
pub fn flush() {
    if let Some(client) = sentry::Hub::current().client() {
        client.flush(Some(Duration::from_secs(2)));
    }
}

/// Replaces the home folder with `~` wherever it appears in `value`.
fn scrub<T: Serialize + DeserializeOwned>(value: T) -> T {
    let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) else {
        return value;
    };
    let home = home.to_string_lossy();
    // Too short to be a real home folder: would replace far too much.
    if home.len() < 4 {
        return value;
    }
    let Ok(json) = serde_json::to_string(&value) else { return value };
    // As it's spelled inside JSON strings (Windows backslashes are doubled).
    let quoted = serde_json::to_string(&home).unwrap_or_default();
    let escaped = quoted.trim_matches('"');
    if !json.contains(escaped) {
        return value;
    }
    serde_json::from_str(&json.replace(escaped, "~")).unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubs_the_home_folder() {
        let home = std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).unwrap();
        let path = std::path::Path::new(&home).join("Library").join("x.csv");
        let crumb =
            Breadcrumb { message: Some(format!("Could not open {}", path.display())), ..Default::default() };
        let message = scrub(crumb).message.unwrap();
        assert!(!message.contains(&home), "{message}");
        assert!(message.starts_with("Could not open ~"), "{message}");
    }

    /// Sends one report to the Sentry project, to check it arrives.
    /// Run with: cargo test sends_a_test_report -- --ignored
    #[test]
    #[ignore = "sends a report to Sentry"]
    fn sends_a_test_report() {
        let sentry = init_sentry("test");
        let id = sentry::capture_message("Test report from cargo test", sentry::Level::Info);
        assert!(sentry.flush(Some(Duration::from_secs(10))), "not sent in time");
        println!("Sent {id}");
    }
}
