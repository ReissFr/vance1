// JARVIS swipe-sense sidecar.
//
// Detects a quick horizontal hand sweep in front of the webcam and emits:
//   {"t":"swipe"}
// Plus {"t":"ready"} on startup and {"t":"error","msg":...} on failures.
//
// Uses Apple's Vision hand-pose landmarks — we track the wrist position over
// a short rolling window (~0.6s). If the wrist has travelled far horizontally
// with little vertical drift, we treat it as a swipe. One swipe per 1.5s max
// so waving your hand doesn't fire repeatedly.
//
// Launched and killed by the Rust side (swipe.rs). Runs only while the user
// has "Swipe to close tab" toggled on.

import AVFoundation
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

final class SwipeSensor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "ai.jarvis.swipe.video")
    private var lastAnalyseAt: TimeInterval = 0
    private let minAnalyseInterval: TimeInterval = 0.1 // ~10 Hz — swipes are fast

    // Rolling wrist history (timestamp, x, y in Vision-normalized coords).
    private var wristHistory: [(t: TimeInterval, x: CGFloat, y: CGFloat)] = []
    private var lastSwipeAt: TimeInterval = 0
    private let swipeWindow: TimeInterval = 0.5
    private let swipeCooldown: TimeInterval = 1.2
    // Horizontal travel required (fraction of frame width).
    private let swipeMinDx: CGFloat = 0.25
    // Vertical drift must stay small or it's a wave, not a swipe.
    private let swipeMaxDrift: CGFloat = 0.18
    // Fraction of sample-to-sample steps that must move in the detected
    // direction. Kills back-and-forth waves that span a wide dx.
    private let swipeMinMonotonicity: CGFloat = 0.7

    func start() throws {
        session.beginConfiguration()
        session.sessionPreset = .vga640x480
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video) else {
            throw NSError(domain: "swipe", code: 1, userInfo: [NSLocalizedDescriptionKey: "no camera"])
        }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "swipe", code: 2, userInfo: [NSLocalizedDescriptionKey: "cannot add camera input"])
        }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else {
            throw NSError(domain: "swipe", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot add video output"])
        }
        session.addOutput(output)
        session.commitConfiguration()
        session.startRunning()
    }

    func stop() { session.stopRunning() }

    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        let now = Date().timeIntervalSince1970
        if now - lastAnalyseAt < minAnalyseInterval { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let request = VNDetectHumanHandPoseRequest { [weak self] req, err in
            guard let self = self else { return }
            if err != nil { return }
            let observations = (req.results as? [VNHumanHandPoseObservation]) ?? []
            let now = Date().timeIntervalSince1970

            // Track the most-confident wrist. Background hands aren't helpful,
            // so we take the single best detection per frame.
            let wrist: CGPoint? = observations
                .compactMap { try? $0.recognizedPoint(.wrist) }
                .filter { $0.confidence > 0.4 }
                .max(by: { $0.confidence < $1.confidence })
                .map { $0.location }
            if let w = wrist {
                self.wristHistory.append((t: now, x: w.x, y: w.y))
            }
            self.wristHistory = self.wristHistory.filter { now - $0.t <= self.swipeWindow }
            guard self.wristHistory.count >= 4 else { return }
            if now - self.lastSwipeAt < self.swipeCooldown { return }

            let xs = self.wristHistory.map { $0.x }
            let ys = self.wristHistory.map { $0.y }
            guard let xMin = xs.min(), let xMax = xs.max(),
                  let yMin = ys.min(), let yMax = ys.max() else { return }
            let dx = xMax - xMin
            let dy = yMax - yMin
            guard dx >= self.swipeMinDx, dy <= self.swipeMaxDrift else { return }

            // Average the first/last pair to smooth out noisy landmarks.
            let n = xs.count
            let head = 0.5 * (xs[0] + xs[1])
            let tail = 0.5 * (xs[n - 1] + xs[n - 2])
            let signedDx = tail - head
            let direction: String = signedDx < 0 ? "left" : "right"

            // Require most sample-to-sample steps to move in the same direction
            // so a left-then-right wave doesn't fire.
            var monotonic = 0
            for i in 1..<n {
                let step = xs[i] - xs[i - 1]
                if (step < 0) == (signedDx < 0) { monotonic += 1 }
            }
            let ratio = CGFloat(monotonic) / CGFloat(n - 1)
            guard ratio >= self.swipeMinMonotonicity else { return }

            emit(["t": "swipe", "dir": direction])
            self.lastSwipeAt = now
            self.wristHistory.removeAll()
        }
        request.maximumHandCount = 2

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
        do {
            try handler.perform([request])
            lastAnalyseAt = now
        } catch {
            emit(["t": "error", "msg": "vision-handler: \(error.localizedDescription)"])
        }
    }
}

let sensor = SwipeSensor()
do {
    try sensor.start()
} catch {
    emit(["t": "error", "msg": "swipe-start: \(error.localizedDescription)"])
    exit(1)
}

emit(["t": "ready"])
RunLoop.main.run()
