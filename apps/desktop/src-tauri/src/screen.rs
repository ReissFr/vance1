// Ambient screen OCR.
//
// Spawns sidecars/screen-sense.bin. Each `ocr` event it emits is cached so
// Tauri callers (the chat UI, the brain proxy) can ask "what's on screen
// right now?" without triggering a fresh capture.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub struct ScreenController {
    inner: Mutex<Option<Running>>,
    cached: Arc<Mutex<Option<ScreenContext>>>,
}

impl Default for ScreenController {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ScreenContext {
    pub app: String,
    pub text: String,
    pub captured_at: u64, // unix seconds
}

struct Running {
    child: Child,
    stop_flag: Arc<AtomicBool>,
}

impl ScreenController {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            cached: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_active(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    pub fn get_context(&self) -> Option<ScreenContext> {
        self.cached.lock().unwrap().clone()
    }

    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            return Ok(());
        }
        let bin = sidecar_path().ok_or_else(|| "screen-sense binary not found".to_string())?;
        let mut child = Command::new(&bin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn screen-sense: {e}"))?;

        let stdout = child.stdout.take().ok_or("no stdout pipe")?;
        let stderr = child.stderr.take();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop_flag.clone();
        let cached_for_thread = self.cached.clone();

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
                    SensorEvent::Ocr { app, text, len } => {
                        let now = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map(|d| d.as_secs())
                            .unwrap_or(0);
                        eprintln!("[screen] OCR {app} ({len} chars)");
                        *cached_for_thread.lock().unwrap() = Some(ScreenContext {
                            app,
                            text,
                            captured_at: now,
                        });
                    }
                    SensorEvent::Ready => eprintln!("[screen] sensor ready"),
                    SensorEvent::NeedsPermission => {
                        eprintln!("[screen] needs Screen Recording permission");
                        // Open the Screen Recording pane so the user can grant it.
                        let _ = Command::new("open")
                            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
                            .spawn();
                    }
                    SensorEvent::Error { msg } => eprintln!("[screen] error: {msg}"),
                }
            }
        });

        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[screen-sense] {line}");
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
        *self.cached.lock().unwrap() = None;
    }
}

fn sidecar_path() -> Option<PathBuf> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest.join("sidecars/screen-sense.bin");
    if dev.exists() {
        return Some(dev);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("screen-sense.bin");
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
    #[serde(rename = "ocr")]
    Ocr {
        app: String,
        text: String,
        len: u64,
    },
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "needs_permission")]
    NeedsPermission,
    #[serde(rename = "error")]
    Error { msg: String },
}
