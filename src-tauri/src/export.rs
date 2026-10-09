// MacMovieMaker — Milestone 6 export backend.
// Spawns ffmpeg for movie export and stream probing using std::process only
// (no shell plugin): the bundled sidecar from resources, falling back to a
// system install on PATH. Progress flows back as `export-progress` /
// `export-done` events; `export_cancel` kills a run.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const SCRIPT_TOKEN: &str = "{FILTER_SCRIPT}";

pub struct ExportState {
    jobs: Mutex<HashMap<String, Arc<ExportJob>>>,
}

struct ExportJob {
    /// The waiter thread never holds this while blocked: it reads the stderr
    /// pipe (taken at spawn) to EOF, then locks briefly to reap.
    child: Mutex<Option<std::process::Child>>,
    script_path: PathBuf,
}

impl ExportState {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ExportRequest {
    /// Client-chosen run id (also used for cancel).
    pub id: String,
    /// Full ffmpeg argv; one element must be "{FILTER_SCRIPT}", replaced here
    /// with the path of a temp file holding `filter_script`.
    pub argv: Vec<String>,
    /// -filter_complex script body.
    pub filter_script: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ExportStarted {
    pub id: String,
    /// Which ffmpeg is running: "sidecar" (bundled) or "system" (PATH).
    pub ffmpeg: String,
}

#[derive(Debug, Serialize, Clone)]
struct ExportProgress {
    id: String,
    /// Microseconds of output written (from -progress out_time_us).
    out_us: u64,
}

#[derive(Debug, Serialize, Clone)]
struct ExportDone {
    id: String,
    ok: bool,
    error: Option<String>,
}

/// Bundled sidecar (`src-tauri/binaries`, shipped under resources), or — for
/// unbundled dev runs — the repo's binaries dir next to the target folder.
fn sidecar_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let arch = std::env::consts::ARCH;
    let name = format!("ffmpeg-{arch}-apple-darwin");
    if let Ok(dir) = app.path().resource_dir() {
        for cand in [dir.join("binaries").join(&name), dir.join(&name)] {
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        // <root>/src-tauri/target/debug/<exe> -> <root>/src-tauri/binaries/<name>
        if let Some(t) = exe.parent().and_then(|d| d.parent()) {
            let cand = t.join("binaries").join(&name);
            if cand.is_file() {
                return Some(cand);
            }
        }
    }
    None
}

fn ffmpeg_program<R: Runtime>(app: &AppHandle<R>) -> (String, &'static str) {
    match sidecar_path(app) {
        Some(p) => (p.to_string_lossy().to_string(), "sidecar"),
        None => ("ffmpeg".to_string(), "system"),
    }
}

fn unique_script_path(id: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let safe: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    std::env::temp_dir().join(format!("mmm-export-{safe}-{nonce}.fffilter"))
}

#[tauri::command]
pub async fn export_movie<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ExportState>,
    req: ExportRequest,
) -> Result<ExportStarted, String> {
    if !req.argv.iter().any(|a| a == SCRIPT_TOKEN) {
        return Err("export plan is missing the {FILTER_SCRIPT} placeholder".into());
    }
    let script_path = unique_script_path(&req.id);
    std::fs::write(&script_path, &req.filter_script)
        .map_err(|e| format!("could not stage the filter script: {e}"))?;
    let script_arg = script_path.to_string_lossy().to_string();
    let argv: Vec<String> = req
        .argv
        .iter()
        .map(|a| {
            if a == SCRIPT_TOKEN {
                script_arg.clone()
            } else {
                a.clone()
            }
        })
        .collect();

    let (program, which) = ffmpeg_program(&app);
    let mut child = std::process::Command::new(&program)
        .args(&argv)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| {
            let _ = std::fs::remove_file(&script_path);
            if which == "system" {
                format!("could not start ffmpeg: {e}. Install it (e.g. `brew install ffmpeg`) or use a bundled build.")
            } else {
                format!("could not start the bundled ffmpeg: {e}")
            }
        })?;
    let stderr = child.stderr.take();
    let job = Arc::new(ExportJob {
        child: Mutex::new(Some(child)),
        script_path: script_path.clone(),
    });
    state.jobs.lock().unwrap().insert(req.id.clone(), job);

    let id = req.id.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut err_tail: Vec<String> = Vec::new();
        let mut saw_end = false;
        if let Some(pipe) = stderr {
            for line in BufReader::new(pipe).lines().map_while(Result::ok) {
                let text = line.trim_end_matches('\r');
                if let Some(us) = text.strip_prefix("out_time_us=") {
                    if let Ok(v) = us.trim().parse::<i64>() {
                        let _ = app2.emit(
                            "export-progress",
                            ExportProgress {
                                id: id.clone(),
                                out_us: v.max(0) as u64,
                            },
                        );
                    }
                } else if text == "progress=end" {
                    saw_end = true;
                } else if !text.trim().is_empty() {
                    err_tail.push(text.to_string());
                    if err_tail.len() > 40 {
                        err_tail.remove(0);
                    }
                }
            }
        }
        // Reap and clean up.
        let mut ok = saw_end;
        let mut code_note: Option<String> = None;
        if let Some(state) = app2.try_state::<ExportState>() {
            if let Some(job) = state.jobs.lock().unwrap().remove(&id) {
                if let Ok(mut guard) = job.child.lock() {
                    if let Some(mut child) = guard.take() {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                if status.success() {
                                    ok = true;
                                } else {
                                    ok = false;
                                    code_note =
                                        Some(format!("ffmpeg exited with status {status}"));
                                }
                            }
                            _ => {
                                // Killed via cancel (or still exiting): wait to reap.
                                match child.wait() {
                                    Ok(status) if status.success() => ok = true,
                                    Ok(status) => {
                                        ok = false;
                                        code_note = Some(format!(
                                            "ffmpeg exited with status {status}"
                                        ));
                                    }
                                    Err(e) => {
                                        ok = false;
                                        code_note = Some(format!("ffmpeg wait failed: {e}"));
                                    }
                                }
                            }
                        }
                    } else {
                        // Cancel took the child already.
                        ok = false;
                        code_note = Some("export cancelled".to_string());
                    }
                }
                let _ = std::fs::remove_file(&job.script_path);
            }
        }
        let error = if ok {
            None
        } else {
            let mut msg = code_note.unwrap_or_else(|| "ffmpeg failed".to_string());
            let tail: Vec<&str> = err_tail
                .iter()
                .rev()
                .filter(|l| {
                    let t = l.trim();
                    !(t.is_empty()
                        || t.starts_with("frame=")
                        || t.starts_with("ffmpeg version")
                        || t.starts_with("built with")
                        || t.starts_with("configuration:"))
                })
                .take(3)
                .map(|s| s.trim())
                .collect();
            if !tail.is_empty() {
                let mut ordered = tail.clone();
                ordered.reverse();
                msg = format!("{msg}: {}", ordered.join(" / "));
            }
            Some(msg)
        };
        let _ = app2.emit("export-done", ExportDone { id, error, ok });
    });

    Ok(ExportStarted {
        id: req.id,
        ffmpeg: which.to_string(),
    })
}

#[tauri::command]
pub fn export_cancel<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, ExportState>,
    id: String,
) -> Result<bool, String> {
    let job = state.jobs.lock().unwrap().remove(&id);
    match job {
        Some(job) => {
            if let Ok(mut guard) = job.child.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    // Reap promptly so the waiter sees a taken child.
                    let _ = child.wait();
                }
            }
            let _ = std::fs::remove_file(&job.script_path);
            Ok(true)
        }
        None => Ok(false),
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct MediaProbe {
    pub has_video: bool,
    pub has_audio: bool,
    /// Container duration in seconds when ffmpeg reports one.
    pub duration: Option<f64>,
}

/// Fast stream probe: `ffmpeg -i` prints the input's streams to stderr.
/// Used to skip audio legs for silent videos (no ffprobe sidecar needed).
#[tauri::command]
pub async fn probe_media<R: Runtime>(app: AppHandle<R>, path: String) -> Result<MediaProbe, String> {
    let (program, _which) = ffmpeg_program(&app);
    let out = std::process::Command::new(&program)
        .args(["-hide_banner", "-i", &path])
        .output()
        .map_err(|e| format!("could not probe {path}: {e}"))?;
    let text = String::from_utf8_lossy(&out.stderr);
    let mut probe = MediaProbe {
        has_video: false,
        has_audio: false,
        duration: None,
    };
    for line in text.lines() {
        let t = line.trim();
        if t.contains("Stream #") && t.contains("Video:") {
            probe.has_video = true;
        }
        if t.contains("Stream #") && t.contains("Audio:") {
            probe.has_audio = true;
        }
        if probe.duration.is_none() {
            if let Some(d) = parse_ffmpeg_duration(t) {
                probe.duration = Some(d);
            }
        }
    }
    Ok(probe)
}

fn parse_ffmpeg_duration(line: &str) -> Option<f64> {
    // "  Duration: 00:00:05.12, start: 0.000000, bitrate: ..." (or N/A)
    let rest = line.split("Duration:").nth(1)?;
    let stamp = rest.split(',').next()?.trim();
    if stamp.eq_ignore_ascii_case("N/A") {
        return None;
    }
    let mut parts = stamp.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

/// Open a URL in the user's browser (macOS `open`). Used by Share v1.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("refusing to open a non-http(s) URL".into());
    }
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("could not open {url}: {e}"))?;
    Ok(())
}
