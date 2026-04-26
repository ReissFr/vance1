// JARVIS gesture-sense sidecar.
//
// Detects a sustained thumbs-up held to the webcam and emits one JSONL event:
//   {"t":"thumb_up"}
// Plus {"t":"ready"} on startup and {"t":"error","msg":...} on failures.
//
// Uses Apple's Vision hand-pose landmarks (VNDetectHumanHandPoseRequest,
// macOS 11+). Classification is pure geometry — thumb tip well above the
// wrist, other fingers curled. We require the pose to hold for ~1s before
// firing, then cool down for 5s so a single thumbs-up can only approve one
// thing.
//
// Launched and killed by the Rust side (gestures.rs). Runs only while the
// user has "Thumbs-up Approve" toggled on in the tray.

import AVFoundation
import Foundation
import Vision

// MARK: - Stdout JSONL emitter

let stdoutLock = NSLock()
func emit(_ obj: [String: Any]) {
    stdoutLock.lock()
    defer { stdoutLock.unlock() }
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

// MARK: - Hand-pose classifier

// Returns true if the observation looks like a clear thumbs-up.
// All coords are Vision-normalized: (0,0) bottom-left, (1,1) top-right.
func isThumbsUp(_ obs: VNHumanHandPoseObservation) -> Bool {
    func pt(_ name: VNHumanHandPoseObservation.JointName) -> CGPoint? {
        guard let p = try? obs.recognizedPoint(name), p.confidence > 0.4 else { return nil }
        return p.location
    }
    guard let wrist = pt(.wrist),
          let thumbTip = pt(.thumbTip),
          let thumbIp = pt(.thumbIP),
          let indexTip = pt(.indexTip),
          let indexPip = pt(.indexPIP),
          let middleTip = pt(.middleTip),
          let middlePip = pt(.middlePIP),
          let ringTip = pt(.ringTip),
          let ringPip = pt(.ringPIP),
          let littleTip = pt(.littleTip),
          let littlePip = pt(.littlePIP) else {
        return false
    }

    // Thumb must be clearly extended upward.
    let thumbExtended = thumbTip.y > thumbIp.y + 0.02 && thumbTip.y > wrist.y + 0.08

    // Other four fingers must be curled: tip at or below its PIP joint.
    let indexCurled = indexTip.y < indexPip.y + 0.02
    let middleCurled = middleTip.y < middlePip.y + 0.02
    let ringCurled = ringTip.y < ringPip.y + 0.02
    let littleCurled = littleTip.y < littlePip.y + 0.02

    // Sanity: thumb tip should be the highest non-wrist point of the hand.
    let thumbHighest = thumbTip.y > indexTip.y && thumbTip.y > middleTip.y

    return thumbExtended && indexCurled && middleCurled && ringCurled && littleCurled && thumbHighest
}

// MARK: - Video capture + per-frame detection

final class HandSensor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "ai.jarvis.gesture.video")
    private var lastAnalyseAt: TimeInterval = 0
    private let minAnalyseInterval: TimeInterval = 0.15 // ~6 Hz cap

    // Debounce: require the pose to hold for `holdDuration` before firing,
    // then silence for `cooldown` so one gesture approves one thing.
    private var thumbUpSince: TimeInterval?
    private var lastEmitAt: TimeInterval = 0
    private let holdDuration: TimeInterval = 1.0
    private let cooldown: TimeInterval = 5.0

    func start() throws {
        session.beginConfiguration()
        session.sessionPreset = .vga640x480
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video) else {
            throw NSError(domain: "gesture", code: 1, userInfo: [NSLocalizedDescriptionKey: "no camera"])
        }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "gesture", code: 2, userInfo: [NSLocalizedDescriptionKey: "cannot add camera input"])
        }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else {
            throw NSError(domain: "gesture", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot add video output"])
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
            if err != nil {
                self.thumbUpSince = nil
                return
            }
            let observations = (req.results as? [VNHumanHandPoseObservation]) ?? []
            let matched = observations.contains(where: isThumbsUp)
            let now = Date().timeIntervalSince1970

            if matched {
                if self.thumbUpSince == nil {
                    self.thumbUpSince = now
                }
                if let since = self.thumbUpSince,
                   now - since >= self.holdDuration,
                   now - self.lastEmitAt >= self.cooldown {
                    emit(["t": "thumb_up"])
                    self.lastEmitAt = now
                    self.thumbUpSince = nil // require a fresh hold for the next one
                }
            } else {
                self.thumbUpSince = nil
            }
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

// MARK: - Entrypoint

let sensor = HandSensor()
do {
    try sensor.start()
} catch {
    emit(["t": "error", "msg": "hand-start: \(error.localizedDescription)"])
    exit(1)
}

emit(["t": "ready"])

// Keep the process alive — sensor runs on AVCaptureSession's own thread.
RunLoop.main.run()
