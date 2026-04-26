// Swipe to close current tab / window.
//
// Reads swipe events from sidecars/swipe-sense.bin. On each swipe, synthesizes
// ⌘W via CGEvent — but only if the frontmost app is a browser, otherwise a
// stray hand wave would close your Xcode file or Word document.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SwipeDirection {
    Left,
    Right,
    Either,
}

impl SwipeDirection {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "left" => Some(Self::Left),
            "right" => Some(Self::Right),
            "either" => Some(Self::Either),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
            Self::Either => "either",
        }
    }
}

pub struct SwipeController {
    inner: Mutex<Option<Running>>,
    direction: Arc<Mutex<SwipeDirection>>,
}

impl Default for SwipeController {
    fn default() -> Self {
        Self::new()
    }
}

struct Running {
    child: Child,
    stop_flag: Arc<AtomicBool>,
}

impl SwipeController {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
            direction: Arc::new(Mutex::new(SwipeDirection::Left)),
        }
    }

    pub fn is_active(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    pub fn get_direction(&self) -> SwipeDirection {
        *self.direction.lock().unwrap()
    }

    pub fn set_direction(&self, dir: SwipeDirection) {
        *self.direction.lock().unwrap() = dir;
    }

    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            return Ok(());
        }
        let bin = sidecar_path().ok_or_else(|| "swipe-sense binary not found".to_string())?;
        let mut child = Command::new(&bin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn swipe-sense: {e}"))?;

        let stdout = child.stdout.take().ok_or("no stdout pipe")?;
        let stderr = child.stderr.take();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop_flag.clone();
        let direction_for_thread = self.direction.clone();

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
                    SensorEvent::Swipe { dir } => {
                        let pref = *direction_for_thread.lock().unwrap();
                        let dir_str = dir.as_deref().unwrap_or("?");
                        if !direction_matches(pref, dir.as_deref()) {
                            eprintln!("[swipe] ignored (dir {dir_str}, prefer {})", pref.as_str());
                            continue;
                        }
                        match frontmost_app_name() {
                            Some(app) if is_browser(&app) => {
                                crate::cg_keyboard::close_current_tab();
                                eprintln!("[swipe] {dir_str} → ⌘W in {app}");
                            }
                            Some(app) => eprintln!("[swipe] ignored (frontmost: {app})"),
                            None => eprintln!("[swipe] ignored (no frontmost app)"),
                        }
                    }
                    SensorEvent::Ready => eprintln!("[swipe] sensor ready"),
                    SensorEvent::Error { msg } => eprintln!("[swipe] sensor error: {msg}"),
                }
            }
        });

        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[swipe-sense] {line}");
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
    let dev = manifest.join("sidecars/swipe-sense.bin");
    if dev.exists() {
        return Some(dev);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("swipe-sense.bin");
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }
    None
}

fn frontmost_app_name() -> Option<String> {
    let out = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to name of first application process whose frontmost is true",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn is_browser(app: &str) -> bool {
    matches!(
        app,
        "Safari"
            | "Google Chrome"
            | "Google Chrome Canary"
            | "Chromium"
            | "Arc"
            | "Firefox"
            | "Firefox Developer Edition"
            | "Brave Browser"
            | "Microsoft Edge"
            | "Opera"
            | "Vivaldi"
            | "Dia"
    )
}

fn direction_matches(pref: SwipeDirection, observed: Option<&str>) -> bool {
    match pref {
        SwipeDirection::Either => true,
        SwipeDirection::Left => observed == Some("left"),
        SwipeDirection::Right => observed == Some("right"),
    }
}

#[derive(Deserialize, Debug)]
#[serde(tag = "t")]
#[allow(dead_code)]
enum SensorEvent {
    #[serde(rename = "swipe")]
    Swipe {
        #[serde(default)]
        dir: Option<String>,
    },
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "error")]
    Error { msg: String },
}
