// JARVIS gaze-sense sidecar.
//
// Streams face presence + head yaw + head pitch on stdout as JSONL. The Rust
// side (gaze.rs) turns pitch into a continuous smooth scroll (small tilt =
// slow, big tilt = fast) and tracks attention over time.
//
// Output shape:
//   {"t":"ready"}
//   {"t":"face","n":<faceCount>,"yaw_deg":<deg|null>,"pitch_deg":<deg|null>}
//   {"t":"error","msg":"<reason>"}

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

final class GazeSensor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "ai.jarvis.gaze.video")
    private var lastEmitAt: TimeInterval = 0
    // ~14 Hz — smooth scroll needs frequent updates.
    private let minEmitInterval: TimeInterval = 0.07

    func start() throws {
        session.beginConfiguration()
        session.sessionPreset = .vga640x480
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video) else {
            throw NSError(domain: "gaze", code: 1, userInfo: [NSLocalizedDescriptionKey: "no camera"])
        }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "gaze", code: 2, userInfo: [NSLocalizedDescriptionKey: "cannot add camera input"])
        }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else {
            throw NSError(domain: "gaze", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot add video output"])
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
        if now - lastEmitAt < minEmitInterval { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let request = VNDetectFaceRectanglesRequest { req, err in
            if let err = err {
                emit(["t": "error", "msg": "vision: \(err.localizedDescription)"])
                return
            }
            let observations = (req.results as? [VNFaceObservation]) ?? []
            var yawOut: Any = NSNull()
            var pitchOut: Any = NSNull()
            if let primary = observations.max(by: { lhs, rhs in
                lhs.boundingBox.width * lhs.boundingBox.height
                    < rhs.boundingBox.width * rhs.boundingBox.height
            }) {
                if let yawRad = primary.yaw?.doubleValue {
                    yawOut = yawRad * 180.0 / .pi
                }
                if let pitchRad = primary.pitch?.doubleValue {
                    pitchOut = pitchRad * 180.0 / .pi
                }
            }
            emit([
                "t": "face",
                "n": observations.count,
                "yaw_deg": yawOut,
                "pitch_deg": pitchOut,
            ])
        }
        request.revision = VNDetectFaceRectanglesRequestRevision3
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
        do {
            try handler.perform([request])
            lastEmitAt = now
        } catch {
            emit(["t": "error", "msg": "vision-handler: \(error.localizedDescription)"])
        }
    }
}

let sensor = GazeSensor()
do {
    try sensor.start()
} catch {
    emit(["t": "error", "msg": "gaze-start: \(error.localizedDescription)"])
    exit(1)
}

emit(["t": "ready"])
RunLoop.main.run()
