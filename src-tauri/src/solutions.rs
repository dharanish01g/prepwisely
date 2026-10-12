//! Runs a Practice question's reference solution against its test cases, using the compilers and interpreters
//! already installed on this computer (see runtimes.rs). The app builds the program (the author's code plus a driver
//! that reads one test case from stdin and prints the result); this compiles it once, then runs it once per case with
//! a time limit, in a temporary folder that is removed afterwards.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::runtimes::locate;

/// Time for one test case to finish.
const CASE_LIMIT: Duration = Duration::from_secs(5);
/// Time to compile. C# restores packages the first time, which can take a while.
const COMPILE_LIMIT: Duration = Duration::from_secs(180);
/// Output kept per stream; the rest is dropped.
const OUTPUT_CAP: u64 = 1024 * 1024;

#[derive(Serialize)]
pub struct CaseOutput {
    stdout: String,
    stderr: String,
    /// None when it was killed (time limit) or stopped by a signal.
    exit_code: Option<i32>,
    timed_out: bool,
    millis: u64,
}

#[derive(Serialize)]
pub struct RunReport {
    /// The compiler's messages when the code didn't compile; then no case ran.
    compile_error: Option<String>,
    /// One per input, in order; shorter when a case timed out and the rest were skipped.
    cases: Vec<CaseOutput>,
}

/// `language`: python, java, c, cpp or csharp. `source`: the full program. `inputs`: each case's stdin.
#[tauri::command]
pub async fn run_solution(language: String, source: String, inputs: Vec<String>) -> Result<RunReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = work_dir()?;
        let report = run_in(&dir, &language, &source, &inputs);
        let _ = std::fs::remove_dir_all(&dir);
        report
    })
    .await
    .map_err(|e| e.to_string())?
}

fn work_dir() -> Result<PathBuf, String> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or_default();
    let dir = std::env::temp_dir().join(format!("prepwisely-run-{}-{nanos}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create a folder to run in: {e}"))?;
    Ok(dir)
}

fn not_installed(language: &str) -> String {
    format!("{language} runtime not installed")
}

fn binary(dir: &Path) -> PathBuf {
    dir.join(if cfg!(windows) { "main.exe" } else { "main" })
}

fn run_in(dir: &Path, language: &str, source: &str, inputs: &[String]) -> Result<RunReport, String> {
    // (file to write, compile command, run command)
    let (file, compile, run): (&str, Option<Command>, Command) = match language {
        "python" => {
            let python = locate(&["python3", "python", "py"]).ok_or_else(|| not_installed("Python"))?;
            let mut run = Command::new(python);
            run.args(["-I", "-X", "utf8", "main.py"]);
            ("main.py", None, run)
        }
        "java" => {
            let javac = locate(&["javac"]).ok_or_else(|| not_installed("Java"))?;
            let java = javac.with_file_name(if cfg!(windows) { "java.exe" } else { "java" });
            let mut compile = Command::new(&javac);
            compile.args(["-encoding", "UTF-8", "-d", "out", "PwMain.java"]);
            let mut run = Command::new(java);
            run.args(["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-cp", "out", "PwMain"]);
            ("PwMain.java", Some(compile), run)
        }
        "c" | "cpp" => {
            let (programs, file, std): (&[&str], &str, &str) = if language == "c" {
                (&["gcc", "clang", "cc"], "main.c", "-std=c11")
            } else {
                (&["g++", "clang++", "c++"], "main.cpp", "-std=c++17")
            };
            let compiler = locate(programs).ok_or_else(|| not_installed(if language == "c" { "C" } else { "C++" }))?;
            let mut compile = Command::new(compiler);
            compile.args([std, "-O1", "-o"]).arg(binary(dir)).arg(file);
            if language == "c" {
                compile.arg("-lm");
            }
            (file, Some(compile), Command::new(binary(dir)))
        }
        "csharp" => {
            let dotnet = locate(&["dotnet"]).ok_or_else(|| not_installed("C#"))?;
            let mut compile = Command::new(&dotnet);
            // A single .cs file builds on its own with the .NET 10 SDK or newer.
            compile.args(["build", "main.cs", "-o", "out", "-nologo", "-v", "q", "-clp:NoSummary"]);
            let mut run = Command::new(dotnet);
            run.arg(Path::new("out").join("main.dll"));
            ("main.cs", Some(compile), run)
        }
        other => return Err(format!("Solutions can't be run in {other}")),
    };

    std::fs::write(dir.join(file), source).map_err(|e| format!("Couldn't write the program: {e}"))?;

    if let Some(mut compile) = compile {
        let out = execute(prepare(&mut compile, dir), "", COMPILE_LIMIT).map_err(|e| format!("Couldn't start the compiler: {e}"))?;
        if out.timed_out {
            return Ok(RunReport { compile_error: Some("Compiling took too long and was stopped.".into()), cases: vec![] });
        }
        if out.exit_code != Some(0) {
            // dotnet prints its errors on stdout; the others on stderr. Drop the temp folder from file paths.
            let text = format!("{}\n{}", out.stderr, out.stdout).replace(&format!("{}/", dir.display()), "");
            let mut text = text.trim().to_string();
            if language == "csharp" && text.contains("main.cs.csproj") && text.contains("NETSDK") {
                text.push_str("\n\nC# solutions need the .NET 10 SDK or newer.");
            }
            return Ok(RunReport { compile_error: Some(truncate(text, 8000)), cases: vec![] });
        }
    }

    let mut cases = Vec::with_capacity(inputs.len());
    for input in inputs {
        let out = execute(prepare(&mut clone(&run), dir), input, CASE_LIMIT).map_err(|e| format!("Couldn't start the program: {e}"))?;
        let timed_out = out.timed_out;
        cases.push(out);
        // An endless loop would cost the full limit on every case: stop here; the rest count as not run.
        if timed_out {
            break;
        }
    }
    Ok(RunReport { compile_error: None, cases })
}

/// A copy of a command (Command isn't Clone), so each case starts fresh.
fn clone(command: &Command) -> Command {
    let mut copy = Command::new(command.get_program());
    copy.args(command.get_args());
    copy
}

fn prepare<'a>(command: &'a mut Command, dir: &Path) -> &'a mut Command {
    command
        .current_dir(dir)
        .env("DOTNET_NOLOGO", "1")
        .env("DOTNET_CLI_TELEMETRY_OPTOUT", "1")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
}

/// Runs a command with `input` on stdin, killing it after `limit`.
fn execute(command: &mut Command, input: &str, limit: Duration) -> std::io::Result<CaseOutput> {
    let started = Instant::now();
    let mut child = command.spawn()?;

    // Feed stdin and drain stdout/stderr on their own threads, so a full pipe never blocks the program.
    let mut stdin = child.stdin.take();
    let input = input.to_string();
    let writer = thread::spawn(move || {
        if let Some(stdin) = stdin.as_mut() {
            let _ = stdin.write_all(input.as_bytes());
        }
    });
    let read = |stream: Option<Box<dyn Read + Send>>| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(stream) = stream {
                let _ = stream.take(OUTPUT_CAP).read_to_end(&mut bytes);
            }
            String::from_utf8_lossy(&bytes).into_owned()
        })
    };
    let stdout = read(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>));
    let stderr = read(child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>));

    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break Some(status);
        }
        if started.elapsed() >= limit {
            timed_out = true;
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        thread::sleep(Duration::from_millis(10));
    };
    let _ = writer.join();

    Ok(CaseOutput {
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
        exit_code: status.and_then(|s| s.code()),
        timed_out,
        millis: started.elapsed().as_millis() as u64,
    })
}

fn truncate(mut text: String, max: usize) -> String {
    if text.len() > max {
        let mut cut = max;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push_str("\n…");
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    /// End-to-end check with this computer's compilers. Reads jobs written by the app's solution-runner
    /// ([{"language", "source", "inputs"}] in the file named by PW_RUN_JOBS) and writes each report next to it.
    /// Run with: PW_RUN_JOBS=/path/jobs.json cargo test -- --ignored run_jobs
    #[test]
    #[ignore]
    fn run_jobs() {
        let path = std::env::var("PW_RUN_JOBS").expect("set PW_RUN_JOBS");
        let jobs: Vec<serde_json::Value> = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let mut reports = Vec::new();
        for job in jobs {
            let inputs: Vec<String> = serde_json::from_value(job["inputs"].clone()).unwrap();
            let dir = work_dir().unwrap();
            let report = run_in(&dir, job["language"].as_str().unwrap(), job["source"].as_str().unwrap(), &inputs);
            let _ = std::fs::remove_dir_all(&dir);
            reports.push(match report {
                Ok(r) => serde_json::to_value(r).unwrap(),
                Err(e) => serde_json::json!({ "error": e }),
            });
        }
        std::fs::write(format!("{path}.out"), serde_json::to_string_pretty(&reports).unwrap()).unwrap();
    }
}
