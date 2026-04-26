// Head-pitch smooth scroll + long-focus attention alert.
//
// Reads face events from sidecars/gaze-sense.bin (Swift / Vision) and applies
// two policies in the same reader thread:
//
// 1. SCROLL — continuous. Head pitch (positive = chin up, negative = chin
//    down) outside a central deadzone drives a small CGEvent scroll every
//    tick, sized by how far the head is tilted. Small tilt = slow scroll,
//    big tilt = fast scroll. No hysteresis / no hard jumps.
//
// 2. ATTENTION — accumulates seconds the user has been present + facing while
//    the same app is frontmost. When the total exceeds ATTENTION_THRESHOLD_SEC
//    we fire one native notification (once per app-session). Resets when the
//    frontmost app changes.
//
// Off by default — toggle from the tray menu. Never starts the camera without
// an explicit on.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;

#[derive(Default)]
pub struct GazeController {
    inner: Mutex<Option<Running>>,
}

struct Running {
    child: Child,
    stop_flag: Arc<AtomicBool>,
}

impl GazeController {
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
        let bin = sidecar_path().ok_or_else(|| "gaze-sense binary not found".to_string())?;
        let mut child = Command::new(&bin)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::null())
            .spawn()
            .map_err(|e| format!("spawn gaze-sense: {e}"))?;

        let stdout = child.stdout.take().ok_or("no stdout pipe")?;
        let stderr = child.stderr.take();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_for_thread = stop_flag.clone();

        std::thread::spawn(move || {
            let mut scroll = ScrollState::default();
            let mut attention = AttentionState::new();
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
                    SensorEvent::Face { n, yaw_deg, pitch_deg } => {
                        scroll.tick(pitch_deg);
                        let facing = n >= 1
                            && yaw_deg.map(|y| y.abs() <= FACING_YAW_DEG).unwrap_or(false);
                        attention.tick(facing);
                    }
                    SensorEvent::Ready => eprintln!("[gaze] sensor ready"),
                    SensorEvent::Error { msg } => eprintln!("[gaze] sensor error: {msg}"),
                }
            }
        });

        if let Some(stderr) = stderr {
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[gaze-sense] {line}");
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
    let dev = manifest.join("sidecars/gaze-sense.bin");
    if dev.exists() {
        return Some(dev);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("gaze-sense.bin");
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
    #[serde(rename = "face")]
    Face {
        n: u32,
        #[serde(default)]
        yaw_deg: Option<f64>,
        #[serde(default)]
        pitch_deg: Option<f64>,
    },
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "error")]
    Error { msg: String },
}

// --- Scroll policy ---------------------------------------------------------

// Pitch in degrees. Positive = chin up (scroll up). Negative = chin down.
//   <8° → deadzone (natural reading posture, no scroll)
//   28° → full-speed scroll
const PITCH_DEADZONE_DEG: f64 = 8.0;
const PITCH_FULL_DEG: f64 = 28.0;
// At ~14 Hz, 90 px/tick ≈ 1260 px/sec at max tilt. Linear ramp (no ease-in)
// so even a small 12° tilt produces ~250 px/sec — actually visible.
const MAX_SCROLL_PX_PER_TICK: f64 = 90.0;

#[derive(Default)]
struct ScrollState {
    // Remember the last sign we scrolled in so we only log direction changes,
    // not every tick.
    last_sign: i32,
    // EMA to smooth out Vision's occasional pitch jitter between frames.
    smoothed_pitch: Option<f64>,
}

impl ScrollState {
    fn tick(&mut self, pitch_deg: Option<f64>) {
        let Some(raw) = pitch_deg else {
            self.last_sign = 0;
            self.smoothed_pitch = None;
            return;
        };
        let pitch = match self.smoothed_pitch {
            Some(prev) => prev * 0.6 + raw * 0.4,
            None => raw,
        };
        self.smoothed_pitch = Some(pitch);

        if pitch.abs() < PITCH_DEADZONE_DEG {
            self.last_sign = 0;
            return;
        }
        let sign: i32 = if pitch > 0.0 { 1 } else { -1 };
        let range = PITCH_FULL_DEG - PITCH_DEADZONE_DEG;
        let mag = ((pitch.abs() - PITCH_DEADZONE_DEG) / range).clamp(0.0, 1.0);
        let px = (mag * MAX_SCROLL_PX_PER_TICK).round() as i32;
        if px < 1 {
            return;
        }
        crate::cg_mouse::scroll(0, px * sign);
        if sign != self.last_sign {
            eprintln!(
                "[gaze] scroll {} start (pitch {:.1}°, {} px/tick)",
                if sign > 0 { "up" } else { "down" },
                pitch,
                px
            );
            self.last_sign = sign;
        }
    }
}

// --- Attention policy ------------------------------------------------------

// Head must be within this yaw for the user to count as "facing the screen".
const FACING_YAW_DEG: f64 = 15.0;
// How long the user can be on one app before we nudge them.
const ATTENTION_THRESHOLD_SEC: f64 = 20.0 * 60.0;
// How often to re-check the frontmost app. osascript is a process spawn, so
// don't hammer it at the face-event rate.
const APP_POLL_INTERVAL: Duration = Duration::from_secs(5);
// Ignore suspiciously-long gaps between ticks (the OS might have slept, or the
// thread blocked) so we don't credit 10 minutes of "facing" in one jump.
const MAX_TICK_GAP: Duration = Duration::from_secs(2);

struct AttentionState {
    current_app: String,
    facing_seconds: f64,
    notified_for_current: bool,
    last_tick: Option<Instant>,
    last_app_check: Option<Instant>,
}

impl AttentionState {
    fn new() -> Self {
        Self {
            current_app: String::new(),
            facing_seconds: 0.0,
            notified_for_current: false,
            last_tick: None,
            last_app_check: None,
        }
    }

    fn tick(&mut self, facing: bool) {
        let now = Instant::now();

        let should_check_app = self
            .last_app_check
            .map(|t| now.duration_since(t) >= APP_POLL_INTERVAL)
            .unwrap_or(true);
        if should_check_app {
            if let Some(app) = frontmost_app_name() {
                if app != self.current_app {
                    self.current_app = app;
                    self.facing_seconds = 0.0;
                    self.notified_for_current = false;
                }
            }
            self.last_app_check = Some(now);
        }

        if let Some(prev) = self.last_tick {
            let delta = now.duration_since(prev);
            if facing && delta <= MAX_TICK_GAP {
                self.facing_seconds += delta.as_secs_f64();
            }
        }
        self.last_tick = Some(now);

        if !self.notified_for_current
            && !self.current_app.is_empty()
            && self.facing_seconds >= ATTENTION_THRESHOLD_SEC
        {
            let mins = (self.facing_seconds / 60.0).round() as i64;
            fire_attention_notification(&self.current_app, mins);
            self.notified_for_current = true;
            eprintln!(
                "[gaze] attention alert: {} for {} min",
                self.current_app, mins
            );
        }
    }
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
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn fire_attention_notification(app: &str, minutes: i64) {
    // Keep the app name safe for embedding inside an AppleScript string.
    let safe_app = app.replace('\\', "\\\\").replace('"', "'");
    let script = format!(
        "display notification \"You've been focused on {app} for {mins} minutes — take a break?\" with title \"JARVIS\" sound name \"Blow\"",
        app = safe_app,
        mins = minutes
    );
    let _ = Command::new("osascript").args(["-e", &script]).status();
}
