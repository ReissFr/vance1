// JARVIS focus-sense sidecar.
//
// Two modes:
//   ./focus-sense          → continuous sensing. Emits JSONL sensor events on
//                            stdout. Reads no stdin. Runs until killed.
//   ./focus-sense playpause → sends a single system-wide play/pause media key
//                             event and exits 0. Used by the Rust side to
//                             pause/resume whatever is playing (Spotify,
//                             Music, browser video, etc).
//
// Sensing emits one JSON object per line. Shapes:
//   {"t":"face","n":<faceCount>,"yaw_deg":<primaryYawDegrees>}
//   {"t":"voice","speaking":<bool>,"confidence":<0..1>}
//   {"t":"error","msg":"<reason>"}
//
// faceCount is the number of human faces visible. yaw_deg is the head
// rotation of the LARGEST face (assumed = the user); positive = right turn,
// negative = left turn, ~0 = facing camera. Null if no face.
//
// Voice events fire only on transitions (speaking on / off) to keep the
// stream cheap. Detection uses Apple's built-in SoundAnalysis "speech"
// classifier (macOS 12+).
//
// We deliberately do NOT identify the user's face or voice in v0 — the Rust
// side combines (faceCount > 1 OR speaking) AND (user looking away) to
// decide when to pause. See focus.rs.

import AVFoundation
import Foundation
import Vision
import SoundAnalysis
import IOKit
import IOKit.hid
import AppKit

// MARK: - One-shot media key

func sendPlayPauseAndExit() -> Never {
    // NX_KEYTYPE_PLAY = 16. We post a system-defined NSEvent with subtype 8
    // (auxiliary control buttons), which is the same path real media keys go
    // through. Works for Spotify, Music, YouTube, Netflix, anything that
    // listens to media keys.
    func post(_ keyDown: Bool) {
        let flags: UInt32 = (keyDown ? 0xa : 0xb) << 8
        let data1 = Int((16 << 16) | Int(flags))
        let event = NSEvent.otherEvent(
            with: .systemDefined,
            location: .zero,
            modifierFlags: [],
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            subtype: 8,
            data1: data1,
            data2: -1
        )
        event?.cgEvent?.post(tap: .cghidEventTap)
    }
    post(true)
    Thread.sleep(forTimeInterval: 0.05)
    post(false)
    exit(0)
}

// MARK: - Stdout JSONL emitter

let stdoutLock = NSLock()
func emit(_ obj: [String: Any]) {
    stdoutLock.lock()
    defer { stdoutLock.unlock() }
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

// MARK: - Face sensing

final class FaceSensor: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "ai.jarvis.focus.video")
    private var lastEmitAt: TimeInterval = 0
    private let minEmitInterval: TimeInterval = 0.25 // ~4 Hz cap

    func start() throws {
        session.beginConfiguration()
        session.sessionPreset = .vga640x480
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video) else {
            throw NSError(domain: "focus", code: 1, userInfo: [NSLocalizedDescriptionKey: "no camera"])
        }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "focus", code: 2, userInfo: [NSLocalizedDescriptionKey: "cannot add camera input"])
        }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else {
            throw NSError(domain: "focus", code: 3, userInfo: [NSLocalizedDescriptionKey: "cannot add video output"])
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
            var primaryYawDeg: Any = NSNull()
            if let primary = observations.max(by: { lhs, rhs in
                lhs.boundingBox.width * lhs.boundingBox.height
                    < rhs.boundingBox.width * rhs.boundingBox.height
            }) {
                if let yawRad = primary.yaw?.doubleValue {
                    primaryYawDeg = yawRad * 180.0 / .pi
                }
            }
            emit([
                "t": "face",
                "n": observations.count,
                "yaw_deg": primaryYawDeg,
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

// MARK: - Voice sensing

@available(macOS 12.0, *)
final class VoiceSensor: NSObject, SNResultsObserving, AVCaptureAudioDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "ai.jarvis.focus.audio")
    private var analyzer: SNAudioStreamAnalyzer?
    private var classifyRequest: SNClassifySoundRequest?
    private var lastSpeakingState: Bool? = nil
    private var lastSpeakingChangeAt: TimeInterval = 0
    // Smooth out flicker — require the new state to persist for ~0.4s before emitting.
    private let stateHysteresisSec: TimeInterval = 0.4
    private var pendingState: (state: Bool, since: TimeInterval)? = nil

    func start() throws {
        guard let device = AVCaptureDevice.default(for: .audio) else {
            throw NSError(domain: "focus", code: 10, userInfo: [NSLocalizedDescriptionKey: "no mic"])
        }
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            throw NSError(domain: "focus", code: 11, userInfo: [NSLocalizedDescriptionKey: "cannot add mic input"])
        }
        session.addInput(input)

        let output = AVCaptureAudioDataOutput()
        output.setSampleBufferDelegate(self, queue: queue)
        guard session.canAddOutput(output) else {
            throw NSError(domain: "focus", code: 12, userInfo: [NSLocalizedDescriptionKey: "cannot add audio output"])
        }
        session.addOutput(output)

        // SNAudioStreamAnalyzer needs the actual format the AVCaptureSession is delivering.
        // We bind it lazily on the first sample buffer.
        session.startRunning()
    }

    func stop() { session.stopRunning() }

    func captureOutput(_ output: AVCaptureOutput,
                       didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              var asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)?.pointee else {
            return
        }

        if analyzer == nil {
            guard let format = AVAudioFormat(streamDescription: &asbd) else {
                emit(["t": "error", "msg": "could not build AVAudioFormat"])
                return
            }
            let a = SNAudioStreamAnalyzer(format: format)
            do {
                let req = try SNClassifySoundRequest(classifierIdentifier: .version1)
                req.windowDuration = CMTime(seconds: 0.75, preferredTimescale: 48000)
                req.overlapFactor = 0.25
                try a.add(req, withObserver: self)
                analyzer = a
                classifyRequest = req
            } catch {
                emit(["t": "error", "msg": "sound-analyzer: \(error.localizedDescription)"])
            }
        }

        if let buffer = sampleBufferToPCM(sampleBuffer) {
            analyzer?.analyze(buffer, atAudioFramePosition: AVAudioFramePosition(buffer.frameLength))
        }
    }

    // MARK: SNResultsObserving
    func request(_ request: SNRequest, didProduce result: SNResult) {
        guard let r = result as? SNClassificationResult else { return }
        let speechConf = r.classification(forIdentifier: "speech")?.confidence ?? 0
        let isSpeaking = speechConf > 0.65

        let now = Date().timeIntervalSince1970
        if pendingState?.state != isSpeaking {
            pendingState = (isSpeaking, now)
        }
        if let pending = pendingState, now - pending.since >= stateHysteresisSec, pending.state != lastSpeakingState {
            lastSpeakingState = pending.state
            lastSpeakingChangeAt = now
            emit([
                "t": "voice",
                "speaking": pending.state,
                "confidence": speechConf,
            ])
        }
    }

    func request(_ request: SNRequest, didFailWithError error: Error) {
        emit(["t": "error", "msg": "sound-request: \(error.localizedDescription)"])
    }
    func requestDidComplete(_ request: SNRequest) {}
}

// Convert a CMSampleBuffer (Audio) to AVAudioPCMBuffer for SoundAnalysis.
func sampleBufferToPCM(_ sample: CMSampleBuffer) -> AVAudioPCMBuffer? {
    guard let formatDescription = CMSampleBufferGetFormatDescription(sample),
          var asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)?.pointee,
          let format = AVAudioFormat(streamDescription: &asbd) else {
        return nil
    }
    let frameCount = AVAudioFrameCount(CMSampleBufferGetNumSamples(sample))
    guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else { return nil }
    pcmBuffer.frameLength = frameCount

    var blockBuffer: CMBlockBuffer?
    var audioBufferList = AudioBufferList()
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sample,
        bufferListSizeNeededOut: nil,
        bufferListOut: &audioBufferList,
        bufferListSize: MemoryLayout<AudioBufferList>.size,
        blockBufferAllocator: kCFAllocatorDefault,
        blockBufferMemoryAllocator: kCFAllocatorDefault,
        flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
        blockBufferOut: &blockBuffer
    )
    if status != noErr { return nil }
    guard let abl = pcmBuffer.audioBufferList.pointee.mBuffers.mData else {
        return pcmBuffer
    }
    if let src = audioBufferList.mBuffers.mData {
        memcpy(abl, src, Int(audioBufferList.mBuffers.mDataByteSize))
    }
    return pcmBuffer
}

// Workaround: AudioStreamBasicDescription needs explicit copy for the inout binding.
extension AudioStreamBasicDescription {
    func copy() -> AudioStreamBasicDescription { self }
}

// MARK: - Entrypoint

let args = CommandLine.arguments
if args.count > 1 && args[1] == "playpause" {
    sendPlayPauseAndExit()
}

let faceSensor = FaceSensor()
do {
    try faceSensor.start()
} catch {
    emit(["t": "error", "msg": "face-start: \(error.localizedDescription)"])
}

if #available(macOS 12.0, *) {
    let voiceSensor = VoiceSensor()
    do {
        try voiceSensor.start()
    } catch {
        emit(["t": "error", "msg": "voice-start: \(error.localizedDescription)"])
    }
} else {
    emit(["t": "error", "msg": "voice classification needs macOS 12+, running face-only"])
}

emit(["t": "ready"])

// Keep the process alive — sensors run on AVCaptureSession's own threads.
RunLoop.main.run()
