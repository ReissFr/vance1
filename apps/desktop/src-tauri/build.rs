use std::path::PathBuf;
use std::process::Command;

fn main() {
    for name in ["focus-sense", "gesture-sense", "gaze-sense", "swipe-sense", "screen-sense"] {
        build_swift_sidecar(name);
    }
    tauri_build::build()
}

// Compile a Swift sidecar (sidecars/<name>/main.swift) to sidecars/<name>.bin,
// which the Rust app spawns at runtime. Re-runs only when main.swift changes.
fn build_swift_sidecar(name: &str) {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let src = manifest_dir.join(format!("sidecars/{name}/main.swift"));
    let out = manifest_dir.join(format!("sidecars/{name}.bin"));

    println!("cargo:rerun-if-changed={}", src.display());

    if !src.exists() {
        println!("cargo:warning={} source missing at {}", name, src.display());
        return;
    }

    // Skip on non-mac hosts — sidecars use mac-only frameworks (Vision etc).
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let status = Command::new("swiftc")
        .arg("-O")
        .arg("-target")
        .arg("arm64-apple-macos12.0")
        .arg(&src)
        .arg("-o")
        .arg(&out)
        .status();

    match status {
        Ok(s) if s.success() => {}
        Ok(s) => println!(
            "cargo:warning={} swiftc failed (exit {}): feature will be disabled",
            name,
            s.code().unwrap_or(-1)
        ),
        Err(e) => println!(
            "cargo:warning=swiftc not available ({e}): {name} feature will be disabled"
        ),
    }
}
