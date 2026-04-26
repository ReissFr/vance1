// JARVIS screen-sense sidecar.
//
// Ambient OCR of whatever window is frontmost. Emits the recognised text to
// stdout as JSONL. The Rust side (screen.rs) caches the latest emission so
// the brain can ask "what's on screen right now?" cheaply.
//
// Strategy:
//   - Poll frontmost app every 2s.
//   - Re-capture when the app changes OR at least 15s since last capture.
//   - Crop to the active app's topmost window (not the whole desktop) so
//     notifications / dock / menu bar don't pollute the text.
//   - OCR via Vision's VNRecognizeTextRequest at .accurate level.
//
// Requires the Screen Recording permission in Privacy & Security. macOS will
// prompt on the first capture; until granted the capture returns a blank
// image and we'll emit {"t":"needs_permission"}.
//
// Output shape:
//   {"t":"ready"}
//   {"t":"ocr","app":"Google Chrome","text":"...","len":1234}
//   {"t":"needs_permission"}
//   {"t":"error","msg":"..."}

import AppKit
import CoreGraphics
import Foundation
import Vision

let stdoutLock = NSLock()
func emit(_ obj: [String: Any]) {
    stdoutLock.lock()
    defer { stdoutLock.unlock() }
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

final class ScreenSensor {
    private var lastApp: String = ""
    private var lastCaptureAt: TimeInterval = 0
    private let refreshInterval: TimeInterval = 15.0
    private var notifiedNeedsPermission = false

    func tick() {
        guard let frontApp = NSWorkspace.shared.frontmostApplication,
              let appName = frontApp.localizedName else { return }
        let now = Date().timeIntervalSince1970
        let appChanged = appName != lastApp
        let stale = now - lastCaptureAt >= refreshInterval
        if !appChanged && !stale { return }

        guard let (image, _) = captureFrontWindow(pid: frontApp.processIdentifier) else {
            // Screen Recording permission not granted yet: CGWindowListCreateImage
            // returns nil or a blank image.
            if !notifiedNeedsPermission {
                emit(["t": "needs_permission"])
                notifiedNeedsPermission = true
            }
            return
        }
        notifiedNeedsPermission = false
        runOCR(image: image, app: appName, at: now)
        lastApp = appName
        lastCaptureAt = now
    }

    private func captureFrontWindow(pid: pid_t) -> (CGImage, CGRect)? {
        let listOpts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let info = CGWindowListCopyWindowInfo(listOpts, kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        // First visible layer-0 window owned by the frontmost app.
        let candidate = info.first { dict in
            guard let owner = dict[kCGWindowOwnerPID as String] as? Int,
                  let layer = dict[kCGWindowLayer as String] as? Int
            else { return false }
            return Int32(owner) == pid && layer == 0
        }
        guard let win = candidate,
              let windowID = win[kCGWindowNumber as String] as? CGWindowID,
              let image = CGWindowListCreateImage(
                  .null,
                  .optionIncludingWindow,
                  windowID,
                  [.boundsIgnoreFraming, .bestResolution]
              )
        else { return nil }
        // A capture that returns a pixel count of 0 is the macOS tell-tale
        // for "screen recording not granted" — return nil so we surface that.
        if image.width < 10 || image.height < 10 { return nil }
        let bounds = (win[kCGWindowBounds as String] as? [String: CGFloat]).flatMap { b -> CGRect? in
            guard let x = b["X"], let y = b["Y"], let w = b["Width"], let h = b["Height"] else { return nil }
            return CGRect(x: x, y: y, width: w, height: h)
        } ?? .zero
        return (image, bounds)
    }

    private func runOCR(image: CGImage, app: String, at: TimeInterval) {
        let request = VNRecognizeTextRequest { req, err in
            if let err = err {
                emit(["t": "error", "msg": "ocr: \(err.localizedDescription)"])
                return
            }
            let observations = (req.results as? [VNRecognizedTextObservation]) ?? []
            let lines = observations.compactMap { $0.topCandidates(1).first?.string }
            let text = lines.joined(separator: "\n")
            emit([
                "t": "ocr",
                "app": app,
                "text": text,
                "len": text.count,
            ])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([request])
            } catch {
                emit(["t": "error", "msg": "ocr-handler: \(error.localizedDescription)"])
            }
        }
    }
}

let sensor = ScreenSensor()
emit(["t": "ready"])
// 2-second poll: light, and "what am I looking at" is rarely more volatile
// than that on a human timescale.
let timer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { _ in
    sensor.tick()
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
