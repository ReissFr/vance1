#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

mod focus;
mod gaze;
mod gestures;
mod screen;
mod swipe;

struct WorkerState {
    children: Mutex<HashMap<String, Child>>,
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        let focused = window.is_focused().unwrap_or(false);
        if visible && focused {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) -> CmdResult {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        CmdResult { ok: true, output: "shown".into() }
    } else {
        CmdResult { ok: false, output: "no main window".into() }
    }
}

#[derive(Serialize, Deserialize)]
struct CmdResult {
    ok: bool,
    output: String,
}

fn run(cmd: &str, args: &[&str]) -> CmdResult {
    match Command::new(cmd).args(args).output() {
        Ok(out) => {
            let combined = if out.status.success() {
                String::from_utf8_lossy(&out.stdout).to_string()
            } else {
                format!(
                    "exit={} stderr={}",
                    out.status.code().unwrap_or(-1),
                    String::from_utf8_lossy(&out.stderr)
                )
            };
            CmdResult { ok: out.status.success(), output: combined }
        }
        Err(e) => CmdResult { ok: false, output: e.to_string() },
    }
}

#[tauri::command]
fn open_url(url: String) -> CmdResult {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return CmdResult { ok: false, output: "only http(s) urls allowed".into() };
    }
    run("open", &[&url])
}

#[tauri::command]
fn launch_app(name: String) -> CmdResult {
    if name.is_empty() || name.contains('\"') || name.contains(';') {
        return CmdResult { ok: false, output: "invalid app name".into() };
    }
    run("open", &["-a", &name])
}

#[tauri::command]
fn run_shortcut(name: String, input: Option<String>) -> CmdResult {
    if name.is_empty() {
        return CmdResult { ok: false, output: "missing shortcut name".into() };
    }
    let mut args: Vec<&str> = vec!["run", &name];
    let input_val;
    if let Some(i) = input.as_ref() {
        input_val = i.clone();
        args.push("--input-path");
        args.push("-");
        let _ = input_val;
    }
    run("shortcuts", &args)
}

#[tauri::command]
fn applescript(code: String) -> CmdResult {
    if code.is_empty() {
        return CmdResult { ok: false, output: "empty script".into() };
    }
    run("osascript", &["-e", &code])
}

fn key_combo_script(combo: &str) -> Result<String, String> {
    let parts: Vec<&str> = combo.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return Err("empty combo".into());
    }
    let (key_part, mod_parts) = parts.split_last().unwrap();
    let mut modifiers: Vec<&'static str> = Vec::new();
    for m in mod_parts {
        match m.to_lowercase().as_str() {
            "cmd" | "command" | "meta" => modifiers.push("command down"),
            "ctrl" | "control" => modifiers.push("control down"),
            "alt" | "option" | "opt" => modifiers.push("option down"),
            "shift" => modifiers.push("shift down"),
            other => return Err(format!("unknown modifier: {}", other)),
        }
    }
    let using = if modifiers.is_empty() {
        String::new()
    } else {
        format!(" using {{{}}}", modifiers.join(", "))
    };
    let key_lower = key_part.to_lowercase();
    let key_code: Option<u16> = match key_lower.as_str() {
        "enter" | "return" => Some(36),
        "tab" => Some(48),
        "space" => Some(49),
        "escape" | "esc" => Some(53),
        "delete" | "backspace" => Some(51),
        "forwarddelete" => Some(117),
        "left" => Some(123),
        "right" => Some(124),
        "down" => Some(125),
        "up" => Some(126),
        "home" => Some(115),
        "end" => Some(119),
        "pageup" => Some(116),
        "pagedown" => Some(121),
        _ => None,
    };
    if let Some(code) = key_code {
        Ok(format!(
            "tell application \"System Events\" to key code {}{}",
            code, using
        ))
    } else if key_part.chars().count() == 1 {
        let ch = key_part.chars().next().unwrap();
        if ch == '"' || ch == '\\' {
            return Err("unsafe key character".into());
        }
        Ok(format!(
            "tell application \"System Events\" to keystroke \"{}\"{}",
            ch, using
        ))
    } else {
        Err(format!("unknown key: {}", key_part))
    }
}

fn focus_prefix(app: &Option<String>) -> Result<String, String> {
    match app {
        Some(name) if !name.is_empty() => {
            if name.contains('"') || name.contains('\\') {
                return Err("invalid app name".into());
            }
            Ok(format!(
                "tell application \"{}\" to activate\ndelay 0.35\n",
                name
            ))
        }
        _ => Ok(String::new()),
    }
}

// CGEvent-based keyboard input — uses JARVIS.app's own Accessibility permission.
mod cg_keyboard {
    use std::ptr;
    use std::thread;
    use std::time::Duration;

    type CGEventRef = *mut std::ffi::c_void;
    type CGEventSourceRef = *mut std::ffi::c_void;

    const KCG_HID_EVENT_TAP: u32 = 0;
    const KCG_EVENT_FLAG_MASK_COMMAND: u64 = 1 << 20;
    const KCG_EVENT_FLAG_MASK_SHIFT: u64 = 1 << 17;
    const KCG_EVENT_FLAG_MASK_CONTROL: u64 = 1 << 18;
    const KCG_EVENT_FLAG_MASK_ALTERNATE: u64 = 1 << 19;

    extern "C" {
        fn CGEventCreateKeyboardEvent(
            source: CGEventSourceRef, virtualKey: u16, keyDown: bool,
        ) -> CGEventRef;
        fn CGEventPost(tap: u32, event: CGEventRef);
        fn CGEventSetFlags(event: CGEventRef, flags: u64);
        fn CGEventKeyboardSetUnicodeString(
            event: CGEventRef, stringLength: u64, unicodeString: *const u16,
        );
        fn CFRelease(cf: *mut std::ffi::c_void);
    }

    pub fn type_string(s: &str) {
        for ch in s.chars() {
            let mut buf = [0u16; 2];
            let encoded = ch.encode_utf16(&mut buf);
            let len = encoded.len() as u64;
            unsafe {
                let down = CGEventCreateKeyboardEvent(ptr::null_mut(), 0, true);
                CGEventKeyboardSetUnicodeString(down, len, buf.as_ptr());
                CGEventPost(KCG_HID_EVENT_TAP, down);
                let up = CGEventCreateKeyboardEvent(ptr::null_mut(), 0, false);
                CGEventKeyboardSetUnicodeString(up, len, buf.as_ptr());
                CGEventPost(KCG_HID_EVENT_TAP, up);
                CFRelease(down);
                CFRelease(up);
            }
            thread::sleep(Duration::from_millis(8));
        }
    }

    pub fn post_key(virtual_key: u16, flags: u64) {
        unsafe {
            let down = CGEventCreateKeyboardEvent(ptr::null_mut(), virtual_key, true);
            if flags != 0 { CGEventSetFlags(down, flags); }
            CGEventPost(KCG_HID_EVENT_TAP, down);
            thread::sleep(Duration::from_millis(30));
            let up = CGEventCreateKeyboardEvent(ptr::null_mut(), virtual_key, false);
            // Carry the same modifier flags on the key-up — Chrome and some
            // other apps ignore ⌘W otherwise (the modifier "lifts" before the
            // key does, so the shortcut is never matched).
            if flags != 0 { CGEventSetFlags(up, flags); }
            CGEventPost(KCG_HID_EVENT_TAP, up);
            CFRelease(down);
            CFRelease(up);
        }
    }

    pub fn resolve_key(name: &str) -> Option<u16> {
        match name.to_lowercase().as_str() {
            "enter" | "return" => Some(36),
            "tab" => Some(48),
            "space" => Some(49),
            "escape" | "esc" => Some(53),
            "delete" | "backspace" => Some(51),
            "forwarddelete" => Some(117),
            "left" => Some(123), "right" => Some(124),
            "down" => Some(125), "up" => Some(126),
            "home" => Some(115), "end" => Some(119),
            "pageup" => Some(116), "pagedown" => Some(121),
            "a" => Some(0), "b" => Some(11), "c" => Some(8), "d" => Some(2),
            "e" => Some(14), "f" => Some(3), "g" => Some(5), "h" => Some(4),
            "i" => Some(34), "j" => Some(38), "k" => Some(40), "l" => Some(37),
            "m" => Some(46), "n" => Some(45), "o" => Some(31), "p" => Some(35),
            "q" => Some(12), "r" => Some(15), "s" => Some(1), "t" => Some(17),
            "u" => Some(32), "v" => Some(9), "w" => Some(13), "x" => Some(7),
            "y" => Some(16), "z" => Some(6),
            "0" => Some(29), "1" => Some(18), "2" => Some(19), "3" => Some(20),
            "4" => Some(21), "5" => Some(23), "6" => Some(22), "7" => Some(26),
            "8" => Some(28), "9" => Some(25),
            _ => None,
        }
    }

    pub fn resolve_modifier(name: &str) -> Option<u64> {
        match name.to_lowercase().as_str() {
            "cmd" | "command" | "meta" => Some(KCG_EVENT_FLAG_MASK_COMMAND),
            "ctrl" | "control" => Some(KCG_EVENT_FLAG_MASK_CONTROL),
            "alt" | "option" | "opt" => Some(KCG_EVENT_FLAG_MASK_ALTERNATE),
            "shift" => Some(KCG_EVENT_FLAG_MASK_SHIFT),
            _ => None,
        }
    }

    // ⌘W — closes the current tab / window in every app we care about.
    pub fn close_current_tab() {
        const VK_W: u16 = 13;
        post_key(VK_W, KCG_EVENT_FLAG_MASK_COMMAND);
    }
}

pub mod cg_mouse {
    use std::ptr;
    use std::thread;
    use std::time::Duration;

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub struct CGPoint { pub x: f64, pub y: f64 }

    type CGEventRef = *mut std::ffi::c_void;
    type CGEventSourceRef = *mut std::ffi::c_void;

    const KCG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
    const KCG_EVENT_LEFT_MOUSE_UP: u32 = 2;
    const KCG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
    const KCG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
    const KCG_EVENT_MOUSE_MOVED: u32 = 5;
    const KCG_MOUSE_BUTTON_LEFT: u32 = 0;
    const KCG_MOUSE_BUTTON_RIGHT: u32 = 1;
    const KCG_HID_EVENT_TAP: u32 = 0;
    const KCG_SCROLL_EVENT_UNIT_PIXEL: u32 = 0;

    extern "C" {
        fn CGEventCreateMouseEvent(
            source: CGEventSourceRef, mouseType: u32,
            mouseCursorPosition: CGPoint, mouseButton: u32,
        ) -> CGEventRef;
        fn CGEventCreateScrollWheelEvent2(
            source: CGEventSourceRef, units: u32, wheelCount: u32,
            wheel1: i32, wheel2: i32, wheel3: i32,
        ) -> CGEventRef;
        fn CGEventPost(tap: u32, event: CGEventRef);
        fn CFRelease(cf: *mut std::ffi::c_void);
        fn CGMainDisplayID() -> u32;
        fn CGDisplayPixelsWide(display: u32) -> usize;
        fn CGDisplayPixelsHigh(display: u32) -> usize;
    }

    pub fn screen_size() -> (usize, usize) {
        unsafe {
            let d = CGMainDisplayID();
            (CGDisplayPixelsWide(d), CGDisplayPixelsHigh(d))
        }
    }

    pub fn click(x: f64, y: f64, button: &str) {
        let pt = CGPoint { x, y };
        let (down_type, up_type, btn) = if button == "right" {
            (KCG_EVENT_RIGHT_MOUSE_DOWN, KCG_EVENT_RIGHT_MOUSE_UP, KCG_MOUSE_BUTTON_RIGHT)
        } else {
            (KCG_EVENT_LEFT_MOUSE_DOWN, KCG_EVENT_LEFT_MOUSE_UP, KCG_MOUSE_BUTTON_LEFT)
        };
        unsafe {
            let move_ev = CGEventCreateMouseEvent(ptr::null_mut(), KCG_EVENT_MOUSE_MOVED, pt, btn);
            CGEventPost(KCG_HID_EVENT_TAP, move_ev);
            CFRelease(move_ev);
            thread::sleep(Duration::from_millis(30));

            let down = CGEventCreateMouseEvent(ptr::null_mut(), down_type, pt, btn);
            CGEventPost(KCG_HID_EVENT_TAP, down);
            CFRelease(down);
            thread::sleep(Duration::from_millis(50));

            let up = CGEventCreateMouseEvent(ptr::null_mut(), up_type, pt, btn);
            CGEventPost(KCG_HID_EVENT_TAP, up);
            CFRelease(up);
        }
    }

    pub fn double_click(x: f64, y: f64) {
        click(x, y, "left");
        thread::sleep(Duration::from_millis(80));
        click(x, y, "left");
    }

    pub fn scroll(dx: i32, dy: i32) {
        unsafe {
            let ev = CGEventCreateScrollWheelEvent2(
                ptr::null_mut(), KCG_SCROLL_EVENT_UNIT_PIXEL, 2, dy, dx, 0,
            );
            CGEventPost(KCG_HID_EVENT_TAP, ev);
            CFRelease(ev);
        }
    }

    pub fn move_to(x: f64, y: f64) {
        let pt = CGPoint { x, y };
        unsafe {
            let ev = CGEventCreateMouseEvent(
                ptr::null_mut(), KCG_EVENT_MOUSE_MOVED, pt, KCG_MOUSE_BUTTON_LEFT,
            );
            CGEventPost(KCG_HID_EVENT_TAP, ev);
            CFRelease(ev);
        }
    }
}

#[tauri::command]
fn mouse_click(x: f64, y: f64, button: Option<String>) -> CmdResult {
    let btn = button.unwrap_or_else(|| "left".into());
    cg_mouse::click(x, y, &btn);
    CmdResult { ok: true, output: format!("clicked ({}, {})", x, y) }
}

#[tauri::command]
fn mouse_double_click(x: f64, y: f64) -> CmdResult {
    cg_mouse::double_click(x, y);
    CmdResult { ok: true, output: format!("double-clicked ({}, {})", x, y) }
}

#[tauri::command]
fn scroll(direction: String, amount: Option<i32>) -> CmdResult {
    let px = amount.unwrap_or(300);
    let (dx, dy) = match direction.as_str() {
        "up" => (0, px),
        "down" => (0, -px),
        "left" => (px, 0),
        "right" => (-px, 0),
        _ => return CmdResult { ok: false, output: "direction must be up/down/left/right".into() },
    };
    cg_mouse::scroll(dx, dy);
    CmdResult { ok: true, output: format!("scrolled {}", direction) }
}

#[tauri::command]
fn get_screen_size() -> CmdResult {
    let (w, h) = cg_mouse::screen_size();
    CmdResult { ok: true, output: format!("{}x{}", w, h) }
}

#[tauri::command]
fn read_app_text(app: String) -> CmdResult {
    if app.is_empty() || app.contains('"') || app.contains('\\') {
        return CmdResult { ok: false, output: "invalid app name".into() };
    }
    // JXA script — walks the Accessibility UI tree of the named app and
    // dumps role + value/title/description for each element with text.
    // Requires Accessibility permission (already granted for keystroke tools).
    let script = format!(
        r#"
const SE = Application("System Events");
const procs = SE.processes.whose({{name: "{app}"}});
let result;
if (procs.length === 0) {{
  result = "ERROR: app '{app}' is not running";
}} else {{
  const proc = procs[0];
  const out = [];
  let count = 0;
  function walk(el, depth) {{
    if (depth > 9 || count > 1200) return;
    let role = "?";
    try {{ role = el.role(); }} catch(e) {{}}
    let val = "", desc = "", title = "";
    try {{ val = el.value(); }} catch(e) {{}}
    try {{ desc = el.description(); }} catch(e) {{}}
    try {{ title = el.title(); }} catch(e) {{}}
    const parts = [val, title, desc].filter(s => s && typeof s === 'string' && s.trim().length > 0 && s.length < 600);
    if (parts.length) {{
      out.push("[" + role + "] " + parts.join(" | "));
      count++;
    }}
    let kids = [];
    try {{ kids = el.uiElements(); }} catch(e) {{ return; }}
    for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
  }}
  walk(proc, 0);
  result = out.join("\n");
}}
result;
"#,
        app = app
    );
    let out = Command::new("osascript")
        .args(["-l", "JavaScript", "-e", &script])
        .output();
    match out {
        Ok(o) => {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                let trimmed = if s.len() > 30000 {
                    format!("{}\n…[truncated, {} more chars]", &s[..30000], s.len() - 30000)
                } else {
                    s
                };
                CmdResult { ok: true, output: trimmed }
            } else {
                CmdResult {
                    ok: false,
                    output: format!(
                        "exit={} stderr={}",
                        o.status.code().unwrap_or(-1),
                        String::from_utf8_lossy(&o.stderr)
                    ),
                }
            }
        }
        Err(e) => CmdResult { ok: false, output: e.to_string() },
    }
}

#[tauri::command]
fn capture_screen() -> CmdResult {
    use base64::Engine;
    let tmp = std::env::temp_dir().join(format!("jarvis-screen-{}.jpg", std::process::id()));
    let tmp_str = match tmp.to_str() {
        Some(s) => s.to_string(),
        None => return CmdResult { ok: false, output: "bad temp path".into() },
    };
    // Low-res JPEG for speed — enough for Claude to read UI elements.
    let out = Command::new("screencapture")
        .args(["-x", "-t", "jpg", &tmp_str])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            match std::fs::read(&tmp) {
                Ok(bytes) => {
                    let _ = std::fs::remove_file(&tmp);
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    CmdResult { ok: true, output: format!("data:image/jpeg;base64,{}", b64) }
                }
                Err(e) => CmdResult { ok: false, output: e.to_string() },
            }
        }
        Ok(o) => CmdResult { ok: false, output: String::from_utf8_lossy(&o.stderr).into_owned() },
        Err(e) => CmdResult { ok: false, output: e.to_string() },
    }
}

#[tauri::command]
fn type_text(text: String, app: Option<String>) -> CmdResult {
    if text.is_empty() {
        return CmdResult { ok: false, output: "empty text".into() };
    }
    if let Some(name) = app.as_ref().filter(|n| !n.is_empty()) {
        if name.contains('"') || name.contains('\\') {
            return CmdResult { ok: false, output: "invalid app name".into() };
        }
        let script = format!("tell application \"{}\" to activate", name);
        run("osascript", &["-e", &script]);
        std::thread::sleep(std::time::Duration::from_millis(350));
    }
    cg_keyboard::type_string(&text);
    CmdResult { ok: true, output: "typed".into() }
}

#[tauri::command]
fn press_keys(combo: String, app: Option<String>) -> CmdResult {
    if let Some(name) = app.as_ref().filter(|n| !n.is_empty()) {
        if name.contains('"') || name.contains('\\') {
            return CmdResult { ok: false, output: "invalid app name".into() };
        }
        let script = format!("tell application \"{}\" to activate", name);
        run("osascript", &["-e", &script]);
        std::thread::sleep(std::time::Duration::from_millis(350));
    }
    let parts: Vec<&str> = combo.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return CmdResult { ok: false, output: "empty combo".into() };
    }
    let (key_part, mod_parts) = parts.split_last().unwrap();
    let mut flags: u64 = 0;
    for m in mod_parts {
        match cg_keyboard::resolve_modifier(m) {
            Some(f) => flags |= f,
            None => return CmdResult { ok: false, output: format!("unknown modifier: {}", m) },
        }
    }
    let key_lower = key_part.to_lowercase();
    match cg_keyboard::resolve_key(&key_lower) {
        Some(vk) => {
            cg_keyboard::post_key(vk, flags);
            CmdResult { ok: true, output: "pressed".into() }
        }
        None => CmdResult { ok: false, output: format!("unknown key: {}", key_part) },
    }
}

#[tauri::command]
fn control_spotify(action: String, value: Option<String>) -> CmdResult {
    let script = match action.as_str() {
        "play" => "tell application \"Spotify\" to play".to_string(),
        "pause" => "tell application \"Spotify\" to pause".to_string(),
        "toggle" => "tell application \"Spotify\" to playpause".to_string(),
        "next" => "tell application \"Spotify\" to next track".to_string(),
        "previous" => "tell application \"Spotify\" to previous track".to_string(),
        "volume" => {
            let v = value.unwrap_or_default();
            let n: i32 = match v.parse() {
                Ok(n) if (0..=100).contains(&n) => n,
                _ => return CmdResult { ok: false, output: "volume must be 0-100".into() },
            };
            format!("tell application \"Spotify\" to set sound volume to {}", n)
        }
        "shuffle_on" => "tell application \"Spotify\" to set shuffling to true".to_string(),
        "shuffle_off" => "tell application \"Spotify\" to set shuffling to false".to_string(),
        "now_playing" => "tell application \"Spotify\" to return (name of current track) & \" — \" & (artist of current track)".to_string(),
        other => return CmdResult { ok: false, output: format!("unknown spotify action: {}", other) },
    };
    run("osascript", &["-e", &script])
}

#[tauri::command]
fn play_spotify(query: String) -> CmdResult {
    let q = query.trim();
    if q.is_empty() {
        return CmdResult { ok: false, output: "empty query".into() };
    }
    if q.contains('"') || q.contains('\\') {
        return CmdResult { ok: false, output: "invalid characters in query".into() };
    }

    // 1. Launch Spotify (no-op if already running).
    let launch = run("open", &["-a", "Spotify"]);
    if !launch.ok {
        return CmdResult {
            ok: false,
            output: format!("could not launch Spotify: {}", launch.output),
        };
    }

    // 2. Wait for Spotify to be scriptable. Poll up to ~6s.
    let ready_script = "tell application \"System Events\" to (name of processes) contains \"Spotify\"";
    let mut ready = false;
    for _ in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let r = run("osascript", &["-e", ready_script]);
        if r.ok && r.output.trim() == "true" {
            ready = true;
            break;
        }
    }
    if !ready {
        return CmdResult { ok: false, output: "Spotify did not start in time".into() };
    }
    // Extra beat for AppleScript dictionary to load.
    std::thread::sleep(std::time::Duration::from_millis(400));

    // 3. Tell Spotify to play the top search result.
    let encoded: String = q
        .chars()
        .map(|c| if c == ' ' { "%20".to_string() } else { c.to_string() })
        .collect();
    let play_script = format!(
        "tell application \"Spotify\"\n  activate\n  play track \"spotify:search:{}\"\nend tell",
        encoded
    );
    run("osascript", &["-e", &play_script])
}

fn safe_handle(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_alphanumeric() || "+-_@.".contains(c))
}

fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[tauri::command]
fn imessage_read(limit: Option<u32>, contact: Option<String>) -> CmdResult {
    let lim = limit.unwrap_or(20).min(100);
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return CmdResult { ok: false, output: "HOME not set".into() },
    };
    let db_path = format!("{}/Library/Messages/chat.db", home);

    let where_clause = match contact {
        Some(c) if !c.is_empty() => {
            if !safe_handle(&c) {
                return CmdResult { ok: false, output: "invalid contact identifier".into() };
            }
            format!("WHERE h.id = '{}' OR h.id LIKE '%{}'", c, c)
        }
        _ => String::new(),
    };

    let query = format!(
        "SELECT \
            datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as ts, \
            CASE WHEN m.is_from_me=1 THEN 'me' ELSE COALESCE(h.id, '?') END as sender, \
            COALESCE(m.text, '') as text \
         FROM message m \
         LEFT JOIN handle h ON m.handle_id = h.ROWID \
         {where_clause} \
         ORDER BY m.date DESC \
         LIMIT {lim};",
        where_clause = where_clause,
        lim = lim
    );

    let out = Command::new("sqlite3")
        .args(["-readonly", "-csv", &db_path, &query])
        .output();
    match out {
        Ok(o) => {
            if o.status.success() {
                let s = String::from_utf8_lossy(&o.stdout).to_string();
                let trimmed = if s.len() > 25000 {
                    format!("{}\n…[truncated]", &s[..25000])
                } else {
                    s
                };
                if trimmed.trim().is_empty() {
                    CmdResult { ok: true, output: "(no messages found)".into() }
                } else {
                    CmdResult { ok: true, output: trimmed }
                }
            } else {
                CmdResult {
                    ok: false,
                    output: format!(
                        "sqlite3 failed (Full Disk Access required for ~/Library/Messages/chat.db): {}",
                        String::from_utf8_lossy(&o.stderr)
                    ),
                }
            }
        }
        Err(e) => CmdResult { ok: false, output: e.to_string() },
    }
}

#[tauri::command]
fn imessage_send(to: String, text: String) -> CmdResult {
    if !safe_handle(&to) {
        return CmdResult { ok: false, output: "invalid recipient (use phone or email)".into() };
    }
    if text.is_empty() {
        return CmdResult { ok: false, output: "empty message".into() };
    }
    let body = applescript_escape(&text);
    let script = format!(
        "tell application \"Messages\"\n  \
            set theBuddy to buddy \"{to}\" of (1st service whose service type is iMessage)\n  \
            send \"{body}\" to theBuddy\n\
         end tell",
        to = to,
        body = body
    );
    run("osascript", &["-e", &script])
}

#[tauri::command]
fn contacts_lookup(query: String) -> CmdResult {
    if query.is_empty() {
        return CmdResult { ok: false, output: "empty query".into() };
    }
    if query.contains('"') || query.contains('\\') {
        return CmdResult { ok: false, output: "invalid query".into() };
    }
    let q = query.replace('"', "");
    let script = format!(
        "set output to \"\"\n\
         tell application \"Contacts\"\n  \
            set matches to (every person whose name contains \"{q}\")\n  \
            repeat with p in matches\n    \
                set phs to \"\"\n    \
                repeat with ph in phones of p\n      \
                    set phs to phs & (value of ph) & \"; \"\n    \
                end repeat\n    \
                set ems to \"\"\n    \
                repeat with em in emails of p\n      \
                    set ems to ems & (value of em) & \"; \"\n    \
                end repeat\n    \
                set output to output & (name of p) & \" | phones: \" & phs & \"| emails: \" & ems & \"\\n\"\n  \
            end repeat\n\
         end tell\n\
         return output",
        q = q
    );
    run("osascript", &["-e", &script])
}

#[tauri::command]
fn notes_read(query: Option<String>, limit: Option<u32>) -> CmdResult {
    let lim = limit.unwrap_or(20).min(100);
    let filter = match query {
        Some(q) if !q.is_empty() => {
            if q.contains('"') || q.contains('\\') {
                return CmdResult { ok: false, output: "invalid query".into() };
            }
            format!("(every note whose name contains \"{}\" or body contains \"{}\")", q, q)
        }
        _ => "notes".into(),
    };
    let script = format!(
        "set output to \"\"\n\
         tell application \"Notes\"\n  \
            set ns to {filter}\n  \
            set i to 0\n  \
            repeat with n in ns\n    \
                if i ≥ {lim} then exit repeat\n    \
                set output to output & \"--- \" & (name of n) & \" ---\\n\" & (plaintext of n) & \"\\n\\n\"\n    \
                set i to i + 1\n  \
            end repeat\n\
         end tell\n\
         return output",
        filter = filter,
        lim = lim
    );
    let r = run("osascript", &["-e", &script]);
    if r.ok && r.output.trim().is_empty() {
        CmdResult { ok: true, output: "(no matching notes)".into() }
    } else {
        r
    }
}

#[tauri::command]
fn notes_create(title: String, body: Option<String>) -> CmdResult {
    if title.is_empty() {
        return CmdResult { ok: false, output: "empty title".into() };
    }
    let t = applescript_escape(&title);
    let b = applescript_escape(&body.unwrap_or_default());
    let script = format!(
        "tell application \"Notes\"\n  \
            tell account 1\n    \
                make new note with properties {{name:\"{t}\", body:\"{b}\"}}\n  \
            end tell\n\
         end tell",
        t = t,
        b = b
    );
    run("osascript", &["-e", &script])
}

#[tauri::command]
fn music_control(action: String, value: Option<String>) -> CmdResult {
    let script = match action.as_str() {
        "play" => "tell application \"Music\" to play".to_string(),
        "pause" => "tell application \"Music\" to pause".to_string(),
        "toggle" => "tell application \"Music\" to playpause".to_string(),
        "next" => "tell application \"Music\" to next track".to_string(),
        "previous" => "tell application \"Music\" to previous track".to_string(),
        "volume" => {
            let v = value.unwrap_or_default();
            let n: i32 = match v.parse() {
                Ok(n) if (0..=100).contains(&n) => n,
                _ => return CmdResult { ok: false, output: "volume must be 0-100".into() },
            };
            format!("tell application \"Music\" to set sound volume to {}", n)
        }
        "shuffle_on" => "tell application \"Music\" to set shuffle enabled to true".to_string(),
        "shuffle_off" => "tell application \"Music\" to set shuffle enabled to false".to_string(),
        "now_playing" => "tell application \"Music\" to return (name of current track) & \" — \" & (artist of current track)".to_string(),
        other => return CmdResult { ok: false, output: format!("unknown music action: {}", other) },
    };
    run("osascript", &["-e", &script])
}

#[tauri::command]
fn music_play(query: String) -> CmdResult {
    let q = query.trim();
    if q.is_empty() {
        return CmdResult { ok: false, output: "empty query".into() };
    }
    if q.contains('"') || q.contains('\\') {
        return CmdResult { ok: false, output: "invalid characters in query".into() };
    }
    let launch = run("open", &["-a", "Music"]);
    if !launch.ok {
        return CmdResult { ok: false, output: format!("could not launch Music: {}", launch.output) };
    }
    std::thread::sleep(std::time::Duration::from_millis(800));
    let script = format!(
        "tell application \"Music\"\n  \
            activate\n  \
            try\n    \
                play (first track of library playlist 1 whose name contains \"{q}\" or artist contains \"{q}\")\n    \
                return \"playing from library\"\n  \
            on error\n    \
                return \"no library match for: {q}\"\n  \
            end try\n\
         end tell",
        q = q
    );
    run("osascript", &["-e", &script])
}

#[tauri::command]
fn obsidian_search(query: String) -> CmdResult {
    let vault = std::env::var("OBSIDIAN_VAULT_PATH").unwrap_or_default();
    if vault.is_empty() {
        return CmdResult {
            ok: false,
            output: "OBSIDIAN_VAULT_PATH env var not set (point it at your vault dir)".into(),
        };
    }
    if query.is_empty() {
        return CmdResult { ok: false, output: "empty query".into() };
    }
    if query.contains('\'') || query.contains('"') {
        return CmdResult { ok: false, output: "invalid query".into() };
    }
    let out = Command::new("grep")
        .args([
            "-r",
            "-i",
            "-l",
            "--include=*.md",
            "--max-count=1",
            &query,
            &vault,
        ])
        .output();
    let files = match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(e) => return CmdResult { ok: false, output: e.to_string() },
    };
    let paths: Vec<&str> = files.lines().take(10).collect();
    if paths.is_empty() {
        return CmdResult { ok: true, output: format!("(no matches for '{}')", query) };
    }
    let mut output = String::new();
    for p in &paths {
        output.push_str(&format!("=== {} ===\n", p));
        if let Ok(content) = std::fs::read_to_string(p) {
            let snippet = if content.len() > 1500 {
                format!("{}\n…[truncated]", &content[..1500])
            } else {
                content
            };
            output.push_str(&snippet);
            output.push_str("\n\n");
        }
    }
    CmdResult { ok: true, output }
}

#[derive(Serialize, Deserialize, Clone)]
struct WorkerEvent {
    task_id: String,
    line: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct WorkerExit {
    task_id: String,
    code: Option<i32>,
}

#[tauri::command]
fn spawn_worker(
    app: AppHandle,
    state: tauri::State<'_, WorkerState>,
    task_id: String,
    prompt: String,
    repo: String,
    model: Option<String>,
    worker_path: String,
    anthropic_api_key: String,
) -> CmdResult {
    if task_id.is_empty() || prompt.is_empty() || repo.is_empty() || worker_path.is_empty() {
        return CmdResult { ok: false, output: "missing required arg".into() };
    }
    if anthropic_api_key.is_empty() {
        return CmdResult { ok: false, output: "missing ANTHROPIC_API_KEY".into() };
    }

    {
        let guard = state.children.lock().unwrap();
        if guard.contains_key(&task_id) {
            return CmdResult { ok: false, output: "task already running".into() };
        }
    }

    let model_val = model.unwrap_or_else(|| "claude-haiku-4-5-20251001".into());
    let mut cmd = Command::new("node");
    cmd.arg(&worker_path)
        .args([
            "--task-id",
            &task_id,
            "--prompt",
            &prompt,
            "--repo",
            &repo,
            "--model",
            &model_val,
        ])
        .env("ANTHROPIC_API_KEY", &anthropic_api_key)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return CmdResult { ok: false, output: format!("spawn failed: {}", e) },
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => return CmdResult { ok: false, output: "no stdout pipe".into() },
    };
    let stderr = child.stderr.take();

    {
        let mut guard = state.children.lock().unwrap();
        guard.insert(task_id.clone(), child);
    }

    // Stream stdout — one event per line (worker emits JSONL).
    let app_out = app.clone();
    let task_out = task_id.clone();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let _ = app_out.emit(
                "worker:event",
                WorkerEvent { task_id: task_out.clone(), line },
            );
        }
    });

    // Drain stderr too — surface as events with `__stderr__` marker so the UI can log.
    if let Some(stderr) = stderr {
        let app_err = app.clone();
        let task_err = task_id.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let payload = format!("{{\"kind\":\"stderr\",\"content\":{}}}", serde_json::to_string(&line).unwrap_or_default());
                let _ = app_err.emit(
                    "worker:event",
                    WorkerEvent { task_id: task_err.clone(), line: payload },
                );
            }
        });
    }

    // Wait for exit in a third thread so the state map stays accurate.
    let app_wait = app.clone();
    let task_wait = task_id.clone();
    std::thread::spawn(move || {
        let state = app_wait.state::<WorkerState>();
        let mut child = {
            let mut guard = state.children.lock().unwrap();
            match guard.remove(&task_wait) {
                Some(c) => c,
                None => return,
            }
        };
        let code = match child.wait() {
            Ok(status) => status.code(),
            Err(_) => None,
        };
        let _ = app_wait.emit(
            "worker:exit",
            WorkerExit { task_id: task_wait, code },
        );
    });

    CmdResult { ok: true, output: "spawned".into() }
}

#[derive(Serialize, Deserialize, Clone)]
struct WorkerConfig {
    worker_path: String,
    anthropic_api_key: String,
    default_repo: String,
}

#[tauri::command]
fn get_worker_config() -> Result<WorkerConfig, String> {
    let key = std::env::var("ANTHROPIC_API_KEY").unwrap_or_default();
    let worker_path = std::env::var("JARVIS_WORKER_PATH").unwrap_or_default();
    let default_repo = std::env::var("JARVIS_DEFAULT_REPO").unwrap_or_default();
    if worker_path.is_empty() {
        return Err("JARVIS_WORKER_PATH not set in env".into());
    }
    if key.is_empty() {
        return Err("ANTHROPIC_API_KEY not set in env".into());
    }
    Ok(WorkerConfig {
        worker_path,
        anthropic_api_key: key,
        default_repo,
    })
}

#[tauri::command]
fn cancel_worker(state: tauri::State<'_, WorkerState>, task_id: String) -> CmdResult {
    let mut guard = state.children.lock().unwrap();
    match guard.get_mut(&task_id) {
        Some(child) => match child.kill() {
            Ok(_) => CmdResult { ok: true, output: "killed".into() },
            Err(e) => CmdResult { ok: false, output: e.to_string() },
        },
        None => CmdResult { ok: false, output: "task not running".into() },
    }
}

#[derive(Serialize, Deserialize)]
struct PermissionStatus {
    accessibility: bool,
    screen_recording: bool,
    full_disk_access: bool,
}

#[tauri::command]
fn check_permissions() -> PermissionStatus {
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }

    // Test accessibility by trying to read a UI element via osascript.
    let ax_test = Command::new("osascript")
        .args(["-e", "tell application \"System Events\" to return count of processes"])
        .output();
    let accessibility = ax_test.map(|o| o.status.success()).unwrap_or(false);

    let screen_recording = unsafe { CGPreflightScreenCaptureAccess() };

    let home = std::env::var("HOME").unwrap_or_default();
    let db_path = format!("{}/Library/Messages/chat.db", home);
    let full_disk_access = std::fs::File::open(&db_path).is_ok();

    PermissionStatus { accessibility, screen_recording, full_disk_access }
}

#[tauri::command]
fn focus_start(controller: tauri::State<'_, focus::FocusController>) -> CmdResult {
    match controller.start() {
        Ok(_) => CmdResult { ok: true, output: "focus pause on".into() },
        Err(e) => CmdResult { ok: false, output: e },
    }
}

#[tauri::command]
fn focus_stop(controller: tauri::State<'_, focus::FocusController>) -> CmdResult {
    controller.stop();
    CmdResult { ok: true, output: "focus pause off".into() }
}

#[tauri::command]
fn focus_is_active(controller: tauri::State<'_, focus::FocusController>) -> bool {
    controller.is_active()
}

#[tauri::command]
fn gesture_start(
    app: AppHandle,
    controller: tauri::State<'_, gestures::GestureController>,
) -> CmdResult {
    match controller.start(app) {
        Ok(_) => CmdResult { ok: true, output: "thumbs-up approve on".into() },
        Err(e) => CmdResult { ok: false, output: e },
    }
}

#[tauri::command]
fn gesture_stop(controller: tauri::State<'_, gestures::GestureController>) -> CmdResult {
    controller.stop();
    CmdResult { ok: true, output: "thumbs-up approve off".into() }
}

#[tauri::command]
fn gesture_is_active(controller: tauri::State<'_, gestures::GestureController>) -> bool {
    controller.is_active()
}

#[tauri::command]
fn gaze_start(controller: tauri::State<'_, gaze::GazeController>) -> CmdResult {
    match controller.start() {
        Ok(_) => CmdResult { ok: true, output: "gaze on".into() },
        Err(e) => CmdResult { ok: false, output: e },
    }
}

#[tauri::command]
fn gaze_stop(controller: tauri::State<'_, gaze::GazeController>) -> CmdResult {
    controller.stop();
    CmdResult { ok: true, output: "gaze off".into() }
}

#[tauri::command]
fn gaze_is_active(controller: tauri::State<'_, gaze::GazeController>) -> bool {
    controller.is_active()
}

#[tauri::command]
fn swipe_start(controller: tauri::State<'_, swipe::SwipeController>) -> CmdResult {
    match controller.start() {
        Ok(_) => CmdResult { ok: true, output: "swipe on".into() },
        Err(e) => CmdResult { ok: false, output: e },
    }
}

#[tauri::command]
fn swipe_stop(controller: tauri::State<'_, swipe::SwipeController>) -> CmdResult {
    controller.stop();
    CmdResult { ok: true, output: "swipe off".into() }
}

#[tauri::command]
fn swipe_is_active(controller: tauri::State<'_, swipe::SwipeController>) -> bool {
    controller.is_active()
}

#[tauri::command]
fn swipe_get_direction(controller: tauri::State<'_, swipe::SwipeController>) -> String {
    controller.get_direction().as_str().into()
}

#[tauri::command]
fn swipe_set_direction(
    controller: tauri::State<'_, swipe::SwipeController>,
    direction: String,
) -> CmdResult {
    match swipe::SwipeDirection::parse(&direction) {
        Some(d) => {
            controller.set_direction(d);
            CmdResult { ok: true, output: format!("swipe direction = {}", d.as_str()) }
        }
        None => CmdResult { ok: false, output: format!("unknown direction: {direction}") },
    }
}

#[tauri::command]
fn screen_start(controller: tauri::State<'_, screen::ScreenController>) -> CmdResult {
    match controller.start() {
        Ok(_) => CmdResult { ok: true, output: "screen on".into() },
        Err(e) => CmdResult { ok: false, output: e },
    }
}

#[tauri::command]
fn screen_stop(controller: tauri::State<'_, screen::ScreenController>) -> CmdResult {
    controller.stop();
    CmdResult { ok: true, output: "screen off".into() }
}

#[tauri::command]
fn screen_is_active(controller: tauri::State<'_, screen::ScreenController>) -> bool {
    controller.is_active()
}

#[tauri::command]
fn screen_get_context(
    controller: tauri::State<'_, screen::ScreenController>,
) -> Option<screen::ScreenContext> {
    controller.get_context()
}

#[tauri::command]
fn open_permission_settings(permission: String) -> CmdResult {
    let url = match permission.as_str() {
        "accessibility" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "screen_recording" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        "full_disk_access" => "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
        _ => return CmdResult { ok: false, output: "unknown permission type".into() },
    };
    run("open", &[url])
}

fn load_env_local() {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        format!("{home}/jarvis/apps/web/.env.local"),
        format!("{home}/jarvis/.env.local"),
        "/Users/reissfrost/jarvis/apps/web/.env.local".to_string(),
    ];
    for path in candidates.iter() {
        if std::path::Path::new(path).exists() {
            let _ = dotenvy::from_path(path);
            break;
        }
    }
    augment_path();
}

// .app bundles launched from Finder / LaunchServices inherit a minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin), so `node` and `git` are unreachable when
// we spawn child processes. Prepend the common homebrew / volta / fnm / nvm
// locations so Command::new("node") just works.
fn augment_path() {
    let home = std::env::var("HOME").unwrap_or_default();
    let existing = std::env::var("PATH").unwrap_or_default();
    let mut prefixes: Vec<String> = vec![
        "/opt/homebrew/bin".into(),
        "/usr/local/bin".into(),
        format!("{home}/.volta/bin"),
        format!("{home}/.bun/bin"),
        format!("{home}/.cargo/bin"),
    ];
    // Pick up fnm / nvm active node bins too (glob-free; just check the most
    // common "default"-like locations).
    for sub in [".fnm/aliases/default/bin", ".nvm/alias/default/bin"] {
        prefixes.push(format!("{home}/{sub}"));
    }
    let mut parts: Vec<String> = prefixes.into_iter().filter(|p| std::path::Path::new(p).exists()).collect();
    if !existing.is_empty() {
        parts.push(existing);
    }
    std::env::set_var("PATH", parts.join(":"));
}

// Scrolling, keystrokes, and UI reads all need Accessibility. macOS only
// surfaces the permission pane if the app asks for it. Called once on launch —
// no-op if already granted.
fn prompt_accessibility_if_needed() {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
    }
    let trusted = unsafe { AXIsProcessTrusted() };
    if trusted {
        return;
    }
    let _ = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .spawn();
    eprintln!(
        "[jarvis] Accessibility permission not granted — opened System Settings. \
         Tick JARVIS under Privacy & Security → Accessibility, then relaunch."
    );
}

// Redirect stdout+stderr to /tmp/jarvis.log so eprintln! from the app and its
// sidecar reader threads is visible even when launched via Finder / `open`,
// which otherwise throws away the TTY.
fn redirect_output_to_log() {
    use std::os::unix::io::AsRawFd;
    let path = "/tmp/jarvis.log";
    let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return;
    };
    unsafe {
        libc::dup2(file.as_raw_fd(), libc::STDOUT_FILENO);
        libc::dup2(file.as_raw_fd(), libc::STDERR_FILENO);
    }
    std::mem::forget(file);
    eprintln!("\n---- jarvis-desktop starting ({}) ----", chrono_like_now());
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("epoch {secs}")
}

fn main() {
    redirect_output_to_log();

    // When launched from Finder / LaunchAgent the .app doesn't inherit a shell
    // environment, so vars like JARVIS_WORKER_PATH and ANTHROPIC_API_KEY are
    // missing. Hunt for apps/web/.env.local in the usual dev locations and
    // merge any vars it defines that aren't already set.
    load_env_local();

    tauri::Builder::default()
        .manage(WorkerState { children: Mutex::new(HashMap::new()) })
        .manage(focus::FocusController::new())
        .manage(gestures::GestureController::new())
        .manage(gaze::GazeController::new())
        .manage(swipe::SwipeController::new())
        .manage(screen::ScreenController::new())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Prompt for Accessibility on first launch — scroll/keystroke/UI
            // reads silently fail without it. Camera + mic auto-prompt later
            // when a sensor first starts (Info.plist has the usage strings).
            prompt_accessibility_if_needed();

            // Register ⌥Space global hotkey.
            let _ = app.global_shortcut().register("Alt+Space");

            // Auto-start on login (enabled by default, user can flip from login items).
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_autostart::ManagerExt;
                let manager = app.autolaunch();
                let _ = manager.enable();
            }

            // System tray icon.
            let show_item = MenuItem::with_id(app, "show", "Show JARVIS", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let focus_item = MenuItem::with_id(app, "focus_toggle", "Focus Pause: OFF", true, None::<&str>)?;
            let gesture_item = MenuItem::with_id(app, "gesture_toggle", "Thumbs-up Approve: OFF", true, None::<&str>)?;
            let swipe_item = MenuItem::with_id(app, "swipe_toggle", "Swipe to close tab: OFF", true, None::<&str>)?;
            let gaze_item = MenuItem::with_id(app, "gaze_toggle", "Head-tilt scroll: OFF", true, None::<&str>)?;
            let screen_item = MenuItem::with_id(app, "screen_toggle", "Ambient screen context: OFF", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &focus_item, &gesture_item, &swipe_item, &gaze_item, &screen_item, &quit_item])?;

            let focus_item_for_menu = focus_item.clone();
            let gesture_item_for_menu = gesture_item.clone();
            let swipe_item_for_menu = swipe_item.clone();
            let gaze_item_for_menu = gaze_item.clone();
            let screen_item_for_menu = screen_item.clone();
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "focus_toggle" => {
                        let controller = app.state::<focus::FocusController>();
                        if controller.is_active() {
                            controller.stop();
                            let _ = focus_item_for_menu.set_text("Focus Pause: OFF");
                        } else {
                            match controller.start() {
                                Ok(_) => {
                                    let _ = focus_item_for_menu.set_text("Focus Pause: ON");
                                }
                                Err(e) => {
                                    eprintln!("[focus] start failed: {e}");
                                    let _ = focus_item_for_menu.set_text("Focus Pause: OFF");
                                }
                            }
                        }
                    }
                    "gesture_toggle" => {
                        let controller = app.state::<gestures::GestureController>();
                        if controller.is_active() {
                            controller.stop();
                            let _ = gesture_item_for_menu.set_text("Thumbs-up Approve: OFF");
                        } else {
                            match controller.start(app.clone()) {
                                Ok(_) => {
                                    let _ = gesture_item_for_menu.set_text("Thumbs-up Approve: ON");
                                }
                                Err(e) => {
                                    eprintln!("[gesture] start failed: {e}");
                                    let _ = gesture_item_for_menu.set_text("Thumbs-up Approve: OFF");
                                }
                            }
                        }
                    }
                    "swipe_toggle" => {
                        let controller = app.state::<swipe::SwipeController>();
                        if controller.is_active() {
                            controller.stop();
                            let _ = swipe_item_for_menu.set_text("Swipe to close tab: OFF");
                        } else {
                            match controller.start() {
                                Ok(_) => {
                                    let _ = swipe_item_for_menu.set_text("Swipe to close tab: ON");
                                }
                                Err(e) => {
                                    eprintln!("[swipe] start failed: {e}");
                                    let _ = swipe_item_for_menu.set_text("Swipe to close tab: OFF");
                                }
                            }
                        }
                    }
                    "gaze_toggle" => {
                        let controller = app.state::<gaze::GazeController>();
                        if controller.is_active() {
                            controller.stop();
                            let _ = gaze_item_for_menu.set_text("Head-tilt scroll: OFF");
                        } else {
                            match controller.start() {
                                Ok(_) => {
                                    let _ = gaze_item_for_menu.set_text("Head-tilt scroll: ON");
                                }
                                Err(e) => {
                                    eprintln!("[gaze] start failed: {e}");
                                    let _ = gaze_item_for_menu.set_text("Head-tilt scroll: OFF");
                                }
                            }
                        }
                    }
                    "screen_toggle" => {
                        let controller = app.state::<screen::ScreenController>();
                        if controller.is_active() {
                            controller.stop();
                            let _ = screen_item_for_menu.set_text("Ambient screen context: OFF");
                        } else {
                            match controller.start() {
                                Ok(_) => {
                                    let _ = screen_item_for_menu.set_text("Ambient screen context: ON");
                                }
                                Err(e) => {
                                    eprintln!("[screen] start failed: {e}");
                                    let _ = screen_item_for_menu.set_text("Ambient screen context: OFF");
                                }
                            }
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it instead of quitting — quit via tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            show_window,
            open_url,
            launch_app,
            run_shortcut,
            applescript,
            play_spotify,
            control_spotify,
            type_text,
            press_keys,
            capture_screen,
            read_app_text,
            imessage_read,
            imessage_send,
            contacts_lookup,
            notes_read,
            notes_create,
            music_control,
            music_play,
            obsidian_search,
            spawn_worker,
            cancel_worker,
            get_worker_config,
            mouse_click,
            mouse_double_click,
            scroll,
            get_screen_size,
            check_permissions,
            open_permission_settings,
            focus_start,
            focus_stop,
            focus_is_active,
            gesture_start,
            gesture_stop,
            gesture_is_active,
            gaze_start,
            gaze_stop,
            gaze_is_active,
            swipe_start,
            swipe_stop,
            swipe_is_active,
            swipe_get_direction,
            swipe_set_direction,
            screen_start,
            screen_stop,
            screen_is_active,
            screen_get_context
        ])
        .run(tauri::generate_context!())
        .expect("error while running JARVIS desktop");
}
