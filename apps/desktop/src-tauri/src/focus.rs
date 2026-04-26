// Focus pause: pauses media when (someone else's face appears OR a voice is
// heard) AND the user turns away from the screen. Resumes when the user looks
// back at the screen.
//
// Architecture:
//   - sidecars/focus-sense.bin (Swift) streams sensor events on stdout.
//   - This module parses them, runs the state machine, and shells out to the
//     SAME binary in `playpause` mode to send a system media-key event when
//     the decision flips.
//
// Toggle from the tray menu. Off by default — never starts the camera/mic
// without an explicit on.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;

#[derive(Default)]
pub struct FocusController {
    inner: Mutex<Option<Running>>,
}

struct Running {
    child: Child,
    stop_flag: Arc<AtomicBool>,
}

impl FocusController {
    pub fn new() -> Self {
        Self { inner: Mutex::new(None) }
    }

    pub fn is_active(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    pub fn start(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            return Ok(());
        }
        let bin = sidecar_path().ok_or_else(|| "focus-sense binary not found".to_string())?;
        let mut child = Command::new(&bin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn focus-sense: {e}"))?;

        let stdout = child.stdout.take().ok_or("no stdout pipe")?;
        let stderr = child.stderr.take();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop_flag.clone();
        let bin_for_thread = bin.clone();

        std::thread::spawn(move || {
            let mut state = StateMachine::default();
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
                if let Some(action) = state.apply(evt) {
                    let _ = Command::new(&bin_for_thread)
                        .arg("playpause")
                        .status();
                    eprintln!("[focus] {:?} → playpause sent", action);
                }
            }
        });

        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[focus-sense] {line}");
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
    // Dev path — alongside the source.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev = manifest.join("sidecars/focus-sense.bin");
    if dev.exists() {
        return Some(dev);
    }
    // Bundled .app — sits next to the main binary in Contents/MacOS.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("focus-sense.bin");
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }
    None
}

// --- Event parsing ---------------------------------------------------------

#[derive(Deserialize, Debug)]
#[serde(tag = "t")]
#[allow(dead_code)]
enum SensorEvent {
    #[serde(rename = "face")]
    Face {
        n: u32,
        #[serde(default)]
        yaw_deg: Option<f64>,
    },
    #[serde(rename = "voice")]
    Voice {
        speaking: bool,
        #[serde(default)]
        confidence: Option<f64>,
    },
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "error")]
    Error { msg: String },
}

// --- State machine ---------------------------------------------------------

#[derive(Debug)]
enum Action {
    Pause,
    Resume,
}

struct StateMachine {
    // Sensor snapshot
    face_count: u32,
    primary_yaw_deg: f64,
    voice_other: bool,

    // Derived
    paused_by_us: bool,

    // Hysteresis: how long the user has been facing-away or facing-back.
    last_facing_back_at: Option<Instant>,
    last_facing_away_at: Option<Instant>,
}

impl Default for StateMachine {
    fn default() -> Self {
        Self {
            face_count: 0,
            primary_yaw_deg: 0.0,
            voice_other: false,
            paused_by_us: false,
            last_facing_back_at: None,
            last_facing_away_at: None,
        }
    }
}

// Yaw in degrees: ~0 = facing camera, ±35+ = clearly turned. Use generous
// thresholds so a quick glance doesn't trigger.
const YAW_AWAY_DEG: f64 = 30.0;
const YAW_BACK_DEG: f64 = 15.0;
// Require the new state to persist for this long before acting. Stops a single
// frame of misclassification from pausing the user's music.
const FACING_DEBOUNCE: Duration = Duration::from_millis(700);

impl StateMachine {
    fn apply(&mut self, evt: SensorEvent) -> Option<Action> {
        let now = Instant::now();

        match evt {
            SensorEvent::Face { n, yaw_deg } => {
                self.face_count = n;
                if let Some(y) = yaw_deg {
                    self.primary_yaw_deg = y;
                }
                let user_present = n >= 1;
                let user_facing_back = user_present && self.primary_yaw_deg.abs() <= YAW_BACK_DEG;
                let user_facing_away = !user_present || self.primary_yaw_deg.abs() >= YAW_AWAY_DEG;

                if user_facing_back {
                    if self.last_facing_back_at.is_none() {
                        self.last_facing_back_at = Some(now);
                    }
                    self.last_facing_away_at = None;
                } else if user_facing_away {
                    if self.last_facing_away_at.is_none() {
                        self.last_facing_away_at = Some(now);
                    }
                    self.last_facing_back_at = None;
                } else {
                    // In-between angle — don't move the debounce clocks.
                }
            }
            SensorEvent::Voice { speaking, .. } => {
                self.voice_other = speaking;
            }
            SensorEvent::Ready => {
                eprintln!("[focus] sensor ready");
                return None;
            }
            SensorEvent::Error { msg } => {
                eprintln!("[focus] sensor error: {msg}");
                return None;
            }
        }

        let disturbance = self.face_count >= 2 || self.voice_other;
        let user_facing_away_committed = self
            .last_facing_away_at
            .map(|t| now.duration_since(t) >= FACING_DEBOUNCE)
            .unwrap_or(false);
        let user_facing_back_committed = self
            .last_facing_back_at
            .map(|t| now.duration_since(t) >= FACING_DEBOUNCE)
            .unwrap_or(false);

        if !self.paused_by_us && disturbance && user_facing_away_committed {
            self.paused_by_us = true;
            return Some(Action::Pause);
        }
        if self.paused_by_us && user_facing_back_committed {
            self.paused_by_us = false;
            return Some(Action::Resume);
        }
        None
    }
}
