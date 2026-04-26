// Thumbs-up to approve: spawns sidecars/gesture-sense.bin (Swift) and forwards
// its thumb_up events to the webview as Tauri events. The web side then
// approves the most recent needs_approval task via its existing Supabase
// session.
//
// Toggle from the tray menu. Off by default — the camera never starts without
// an explicit on.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct GestureController {
    inner: Mutex<Option<Running>>,
}

struct Running {
    child: Child,
    stop_flag: Arc<AtomicBool>,
}

impl GestureController {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    pub fn is_active(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            return Ok(());
        }
        let bin = sidecar_path().ok_or_else(|| "gesture-sense binary not found".to_string())?;
        let mut child = Command::new(&bin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn gesture-sense: {e}"))?;

        let stdout = child.stdout.take().ok_or("no stdout pipe")?;
        let stderr = child.stderr.take();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop_flag.clone();
        let app_for_thread = app.clone();

        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if stop_for_thread.load(Ordering::Relaxed) {
                    break;
                }
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let evt: SensorEvent = match serde_json::from_str(trimmed) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                match evt {
                    SensorEvent::ThumbUp => {
                        let _ = app_for_thread.emit("gesture:thumbs_up", ());
                        eprintln!("[gesture] thumb_up → event emitted");
                    }
                    SensorEvent::Ready => eprintln!("[gesture] sensor ready"),
                    SensorEvent::Error { msg } => eprintln!("[gesture] sensor error: {msg}"),
                }
            }
        });

        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[gesture-sense] {line}");
                }
            });
        }

        *guard = Some(Running { child, stop_flag });
        Ok(())
    }

    pub fn stop(&self) {
        let mut guard = self.inner.lock().unwrap();
        if let Some(mut running) = guard.take() {
            running.stop_flag.store(true, Ordering::Relaxed);
            let _ = running.child.kill();
            let _ = running.child.wait();
        }
    }
}

fn sidecar_path() -> Option<PathBuf> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest.join("sidecars/gesture-sense.bin");
    if dev.exists() {
        return Some(dev);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("gesture-sense.bin");
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }
    None
}

#[derive(Deserialize, Debug)]
#[serde(tag = "t")]
#[allow(dead_code)]
enum SensorEvent {
    #[serde(rename = "thumb_up")]
    ThumbUp,
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "error")]
    Error { msg: String },
}
