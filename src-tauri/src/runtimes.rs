//! Which languages this computer can run, for checking Practice solutions. Nothing is installed by prepwisely: a
//! language is ready when its compiler or interpreter is already on this machine.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

#[derive(Serialize)]
pub struct RuntimeStatus {
    /// `c`, `cpp`, `java`, `python` or `csharp`.
    id: &'static str,
    installed: bool,
    /// The tool's own version line, e.g. "Python 3.12.4".
    version: Option<String>,
}

/// Each language and the programs that can run it, first match wins.
const RUNTIMES: &[(&str, &[(&str, &str)])] = &[
    ("c", &[("gcc", "--version"), ("clang", "--version"), ("cc", "--version")]),
    ("cpp", &[("g++", "--version"), ("clang++", "--version"), ("c++", "--version")]),
    ("java", &[("javac", "-version")]),
    ("python", &[("python3", "--version"), ("python", "--version"), ("py", "--version")]),
    ("csharp", &[("dotnet", "--version")]),
];

#[tauri::command]
pub async fn runtime_status() -> Vec<RuntimeStatus> {
    tauri::async_runtime::spawn_blocking(|| {
        RUNTIMES
            .iter()
            .map(|(id, programs)| {
                let version = programs.iter().find_map(|(program, flag)| version_of(program, flag));
                RuntimeStatus { id, installed: version.is_some(), version }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// The first of `programs` that is installed and usable, e.g. `["gcc", "clang", "cc"]`.
pub(crate) fn locate(programs: &[&str]) -> Option<PathBuf> {
    programs.iter().find_map(|p| find(p).filter(|path| usable(path, p)))
}

fn version_of(program: &str, flag: &str) -> Option<String> {
    let path = find(program)?;
    if !usable(&path, program) {
        return None;
    }
    let output = Command::new(&path).arg(flag).stdin(Stdio::null()).output().ok()?;
    if !output.status.success() {
        return None;
    }
    // Some tools (javac) print their version to stderr.
    let text = [output.stdout, output.stderr].concat();
    String::from_utf8_lossy(&text).lines().map(str::trim).find(|l| !l.is_empty()).map(String::from)
}

/// The program's full path: PATH first, then the usual install folders an app launched from the Dock doesn't see.
pub(crate) fn find(program: &str) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if cfg!(target_os = "macos") {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/local/share/dotnet"].map(PathBuf::from));
    }
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(Path::new(&home).join(".dotnet"));
    }
    let names: Vec<String> = if cfg!(windows) { vec![format!("{program}.exe"), program.into()] } else { vec![program.into()] };
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).find(|p| p.is_file())
}

/// On macOS, /usr/bin holds stand-ins for the compilers and Java that open an "install" dialog when run. They only
/// count once the Command Line Tools (or a JDK) are really installed.
pub(crate) fn usable(path: &Path, program: &str) -> bool {
    if !cfg!(target_os = "macos") || !path.starts_with("/usr/bin") {
        return true;
    }
    let check = if program.starts_with("java") { ("/usr/libexec/java_home", None) } else { ("xcode-select", Some("-p")) };
    let mut command = Command::new(check.0);
    if let Some(arg) = check.1 {
        command.arg(arg);
    }
    command.stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}
