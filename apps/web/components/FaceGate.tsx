"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  checkPresence,
  clearEnrollment,
  enrollFromVideo,
  hasEnrollment,
  isFaceGateEnabled,
  loadModels,
  setFaceGateEnabled,
} from "@/lib/face";

export type Presence = "disabled" | "loading" | "no-face" | "unknown" | "me";

export interface FaceGateHandle {
  getPresence: () => Presence;
  isGateActive: () => boolean;
}

const PRESENCE_STICKY_MS = 30_000;
const TICK_MS = 2_000;

export const FaceGate = forwardRef<FaceGateHandle, { onPresenceChange?: (p: Presence) => void }>(
  function FaceGate({ onPresenceChange }, ref) {
    const [enabled, setEnabled] = useState(false);
    const [enrolled, setEnrolled] = useState(false);
    const [presence, setPresence] = useState<Presence>("disabled");
    const [enrolling, setEnrolling] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [open, setOpen] = useState(false);

    const videoRef = useRef<HTMLVideoElement>(null);
    const enrollVideoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastMeAtRef = useRef<number>(0);
    const presenceRef = useRef<Presence>("disabled");
    presenceRef.current = presence;

    useImperativeHandle(ref, () => ({
      getPresence: () => {
        if (!enabled || !enrolled) return "disabled";
        if (presenceRef.current === "me") return "me";
        if (Date.now() - lastMeAtRef.current < PRESENCE_STICKY_MS) return "me";
        return presenceRef.current;
      },
      isGateActive: () => enabled && enrolled,
    }));

    useEffect(() => {
      setEnrolled(hasEnrollment());
      setEnabled(isFaceGateEnabled());
    }, []);

    const stopStream = useCallback(() => {
      if (loopRef.current) {
        clearInterval(loopRef.current);
        loopRef.current = null;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      if (enrollVideoRef.current) enrollVideoRef.current.srcObject = null;
    }, []);

    const attachStream = useCallback(
      async (target: HTMLVideoElement | null) => {
        if (!target) return;
        if (streamRef.current) {
          target.srcObject = streamRef.current;
          await target.play().catch(() => {});
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
          audio: false,
        });
        streamRef.current = stream;
        target.srcObject = stream;
        await target.play().catch(() => {});
      },
      [],
    );

    useEffect(() => {
      if (!enabled || !enrolled) {
        stopStream();
        setPresence("disabled");
        onPresenceChange?.("disabled");
        return;
      }

      let cancelled = false;
      setPresence("loading");
      onPresenceChange?.("loading");

      (async () => {
        try {
          await loadModels();
          await attachStream(videoRef.current);
          if (cancelled) return;
          const tick = async () => {
            const v = videoRef.current;
            if (!v || v.readyState < 2) return;
            const r = await checkPresence(v).catch(() => null);
            if (!r) return;
            let next: Presence;
            if (!r.sawFace) next = "no-face";
            else if (r.match) {
              next = "me";
              lastMeAtRef.current = Date.now();
            } else next = "unknown";
            setPresence(next);
            onPresenceChange?.(next);
          };
          void tick();
          loopRef.current = setInterval(tick, TICK_MS);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setPresence("disabled");
          onPresenceChange?.("disabled");
        }
      })();

      return () => {
        cancelled = true;
        stopStream();
      };
    }, [enabled, enrolled, attachStream, stopStream, onPresenceChange]);

    const handleToggle = (v: boolean) => {
      if (v && !enrolled) {
        setOpen(true);
        return;
      }
      setFaceGateEnabled(v);
      setEnabled(v);
    };

    const handleEnroll = useCallback(async () => {
      setError(null);
      setEnrolling(true);
      const wasEnabled = enabled;
      if (wasEnabled) {
        setEnabled(false);
        stopStream();
        await new Promise((r) => setTimeout(r, 200));
      }
      try {
        await loadModels();
        await attachStream(enrollVideoRef.current);
        if (!enrollVideoRef.current) throw new Error("camera not ready");
        const ok = await enrollFromVideo(enrollVideoRef.current);
        if (!ok) throw new Error("No face detected. Sit facing the camera in good light.");
        setEnrolled(true);
        setFaceGateEnabled(true);
        setEnabled(true);
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        stopStream();
        setEnrolling(false);
      }
    }, [attachStream, enabled, stopStream]);

    const handleRemove = () => {
      clearEnrollment();
      setEnrolled(false);
      setFaceGateEnabled(false);
      setEnabled(false);
    };

    const dotColor =
      !enabled || !enrolled
        ? "bg-white/20"
        : presence === "me"
          ? "bg-green-500"
          : presence === "unknown"
            ? "bg-red-500"
            : presence === "no-face"
              ? "bg-white/30"
              : "bg-yellow-500";

    const dotLabel = !enrolled
      ? "Face lock off — set up"
      : !enabled
        ? "Face lock off"
        : presence === "me"
          ? "Recognised"
          : presence === "unknown"
            ? "Unknown face"
            : presence === "no-face"
              ? "No face visible"
              : "Starting camera…";

    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80"
          title={dotLabel}
          type="button"
        >
          <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
          <span className="hidden sm:inline">{dotLabel}</span>
        </button>

        <video ref={videoRef} className="hidden" muted playsInline />

        {open && (
          <div className="fixed inset-0 z-50 bg-black/60 grid place-items-center p-4">
            <div className="bg-panel border border-white/10 rounded-lg p-5 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Face recognition</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="text-white/40 text-xs"
                  type="button"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-white/60">
                When on, JARVIS only responds when it sees your face. The descriptor is stored
                on this Mac only — never uploaded.
              </p>

              {enrolling && (
                <div className="aspect-video bg-black/50 rounded overflow-hidden">
                  <video ref={enrollVideoRef} className="w-full h-full object-cover" muted playsInline />
                </div>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}

              <div className="flex items-center justify-between text-xs">
                <span className="text-white/70">
                  Status: {enrolled ? (enabled ? "active" : "enrolled, disabled") : "not enrolled"}
                </span>
                {enrolled && (
                  <label className="flex items-center gap-2 text-white/60">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => handleToggle(e.target.checked)}
                      className="accent-accent"
                    />
                    Enabled
                  </label>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleEnroll}
                  disabled={enrolling}
                  className="flex-1 bg-accent text-ink font-medium text-xs px-3 py-2 rounded-md disabled:opacity-40"
                  type="button"
                >
                  {enrolling ? "Look at the camera…" : enrolled ? "Re-enroll" : "Enroll my face"}
                </button>
                {enrolled && (
                  <button
                    onClick={handleRemove}
                    disabled={enrolling}
                    className="text-xs px-3 py-2 text-white/60 border border-white/10 rounded-md hover:text-white/90"
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  },
);
