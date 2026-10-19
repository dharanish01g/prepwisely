mod reporting;
mod runtimes;
mod solutions;

use tauri::RunEvent;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // First, so a panic from here on is reported.
    let sentry = reporting::init_sentry(&context.package_info().version.to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_sentry::init(&sentry))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            reporting::init_logging(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, runtimes::runtime_status, solutions::run_solution])
        .build(context)
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let RunEvent::Exit = event {
                reporting::flush();
            }
        });
}
