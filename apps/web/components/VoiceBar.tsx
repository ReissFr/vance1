"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { runDeviceAction, isTauri } from "@/lib/tauri";
import { startPorcupine, stopPorcupine } from "@/lib/porcupine";

export interface VoiceBarHandle {
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
}

interface Props {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

type Mode = "idle" | "listening" | "armed" | "speaking" | "error";

// "Hey Vance" + common browser mis-hearings. Standalone "vance" also counts since
// it's uncommon enough to not false-trigger.
const WAKE = /\b(?:hey\s+)?(vance|vince|vents|vans|fance|france)\b|\bvance\b/i;
const WAKE_WINDOW_MS = 15_000;
const DUCK_VOLUME = 15;

async function readSystemVolume(): Promise<number | null> {
  if (!isTauri()) return null;
  const r = await runDeviceAction("applescript", {
    code: "output volume of (get volume settings)",
  }).catch(() => ({ ok: false, output: "" }));
  if (!r.ok) return null;
  const n = parseInt(r.output.trim(), 10);
  return Number.isFinite(n) ? n : null;
}

async function writeSystemVolume(vol: number) {
  if (!isTauri()) return;
  await runDeviceAction("applescript", {
    code: `set volume output volume ${vol}`,
  }).catch(() => {});
}

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const VoiceBar = forwardRef<VoiceBarHandle, Props>(function VoiceBar(
  { onTranscript, disabled },
  ref,
) {
  const [mode, setMode] = useState<Mode>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [heard, setHeard] = useState("");

  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const modeRef = useRef<Mode>("idle");
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeUntilRef = useRef<number>(0);
  const wantRunningRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const lastInterimRef = useRef<string>("");
  const savedVolumeRef = useRef<number | null>(null);
  const handleFinalRef = useRef<((text: string) => void) | null>(null);

  modeRef.current = mode;

  const clearArmedTimer = () => {
    if (armedTimerRef.current) {
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
  };

  const duckSystem = useCallback(async () => {
    if (savedVolumeRef.current !== null) return;
    const cur = await readSystemVolume();
    if (cur !== null) savedVolumeRef.current = cur;
    await writeSystemVolume(DUCK_VOLUME);
  }, []);

  const restoreSystem = useCallback(async () => {
    const prev = savedVolumeRef.current;
    if (prev === null) return;
    savedVolumeRef.current = null;
    await writeSystemVolume(prev);
  }, []);

  const arm = useCallback((opts?: { duck?: boolean }) => {
    setHeard("");
    setMode("armed");
    clearArmedTimer();
    wakeUntilRef.current = Date.now() + WAKE_WINDOW_MS;
    if (opts?.duck) void duckSystem();
  }, [duckSystem]);

  const handleFinal = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      setHeard(clean);

      const wakeMatch = WAKE.exec(clean);
      const withinWakeWindow = Date.now() < wakeUntilRef.current;

      if (wakeMatch) {
        // Wake phrase heard — surface the desktop window.
        if (isTauri()) {
          runDeviceAction("show_window", {}).catch(() => {});
        }
        void duckSystem();
        const after = clean.slice(wakeMatch.index + wakeMatch[0].length).replace(/^[,\s]+/, "").trim();
        if (after.length > 0) {
          clearArmedTimer();
          wakeUntilRef.current = 0;
          void restoreSystem();
          onTranscript(after);
        } else {
          // Just the wake phrase — listen for the follow-up command.
          wakeUntilRef.current = Date.now() + WAKE_WINDOW_MS;
          setMode("armed");
        }
        return;
      }

      if (withinWakeWindow) {
        clearArmedTimer();
        wakeUntilRef.current = 0;
        void restoreSystem();
        onTranscript(clean);
      }
      // Otherwise: no wake phrase, not armed — ignore.
    },
    [duckSystem, onTranscript, restoreSystem],
  );

  handleFinalRef.current = handleFinal;

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) {
      setErr("Browser speech recognition not supported — use Chrome or Edge.");
      setMode("error");
      return;
    }
    if (recRef.current) return;
    const rec = new Ctor();
    rec.lang = "en-GB";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => {
      if (modeRef.current === "error") setMode("idle");
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r || !r[0]) continue;
        if (r.isFinal) {
          lastInterimRef.current = "";
          handleFinal(r[0].transcript);
        } else {
          lastInterimRef.current = r[0].transcript;
          setHeard(r[0].transcript);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setErr("Microphone permission denied.");
        setMode("error");
        wantRunningRef.current = false;
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        setErr(`mic: ${e.error}`);
      }
    };
    rec.onend = () => {
      recRef.current = null;
      // Rescue interim if webkit forgot to fire final (common bug).
      // handleFinal will gate on wake phrase / wake window itself.
      const stuckInterim = lastInterimRef.current.trim();
      lastInterimRef.current = "";
      if (stuckInterim) handleFinal(stuckInterim);
      if (wantRunningRef.current && modeRef.current !== "speaking") {
        setTimeout(() => startRecognition(), 50);
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      // already started / race — ignore
    }
  }, [handleFinal]);

  const stopRecognition = useCallback(() => {
    wantRunningRef.current = false;
    recRef.current?.abort();
    recRef.current = null;
  }, []);

  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      audioUnlockedRef.current = true;
      const a = new Audio(
        "data:audio/wav;base64,UklGRhwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
      );
      a.play().catch(() => {});
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("click", unlock);
    document.addEventListener("keydown", unlock);
    document.addEventListener("touchstart", unlock);
    document.addEventListener("pointerdown", unlock);

    wantRunningRef.current = true;
    setMode("idle");
    startRecognition();

    // Porcupine native wake-word detection (reliable when window is hidden).
    // Falls back silently to SpeechRecognition-regex wake when unavailable.
    void startPorcupine(() => {
      handleFinalRef.current?.("hey vance");
    }).then((status) => {
      if (status.ok) {
        console.info("[Porcupine] wake word active:", status.keyword);
      } else {
        console.info("[Porcupine] not active:", status.reason);
      }
    });

    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("keydown", unlock);
      document.removeEventListener("touchstart", unlock);
      document.removeEventListener("pointerdown", unlock);
      wantRunningRef.current = false;
      clearArmedTimer();
      recRef.current?.abort();
      recRef.current = null;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      void restoreSystem();
      void stopPorcupine();
    };
  }, [startRecognition, restoreSystem]);

  useImperativeHandle(ref, () => ({
    speak: async (text: string) => {
      if (!text.trim()) return;

      // Pause recognition so we don't pick up our own voice.
      wantRunningRef.current = false;
      recRef.current?.abort();
      recRef.current = null;

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      setMode("speaking");
      const resume = () => {
        wantRunningRef.current = true;
        arm({ duck: true });
        setTimeout(() => startRecognition(), 300);
      };

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `tts ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resume();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resume();
        };
        try {
          await audio.play();
        } catch (playErr) {
          const msg = playErr instanceof Error ? playErr.message : String(playErr);
          setErr(`audio blocked: ${msg} — click mic once to unlock`);
          console.error("[VoiceBar] audio.play() failed", playErr);
          URL.revokeObjectURL(url);
          audioRef.current = null;
          resume();
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        resume();
      }
    },
    stopSpeaking: () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      wantRunningRef.current = true;
      setMode("listening");
      startRecognition();
    },
  }));

  const label =
    mode === "armed"
      ? "Listening… go ahead"
      : mode === "speaking"
        ? "Speaking… click to interrupt"
        : mode === "listening"
          ? "Mic paused — click to resume"
          : mode === "error"
            ? (err ?? "Error")
            : "Say 'Hey Vance'";

  const unlockAudio = () => {
    if (audioUnlockedRef.current) return;
    audioUnlockedRef.current = true;
    // Silent 1-frame wav to satisfy Chrome autoplay gating.
    const a = new Audio(
      "data:audio/wav;base64,UklGRhwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
    );
    a.play().catch(() => {});
  };

  const onMicClick = () => {
    unlockAudio();
    if (mode === "speaking") {
      window.speechSynthesis?.cancel();
      wantRunningRef.current = true;
      setMode("listening");
      startRecognition();
      return;
    }
    if (mode === "armed") {
      clearArmedTimer();
      setMode("listening");
      void restoreSystem();
      return;
    }
    arm();
  };

  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        type="button"
        onClick={onMicClick}
        disabled={disabled || mode === "error"}
        className={
          "h-10 w-10 rounded-full grid place-items-center border transition-colors " +
          (mode === "armed"
            ? "bg-green-500/20 border-green-500/70 text-green-200 animate-pulse"
            : mode === "speaking"
              ? "bg-accent/20 border-accent/60 text-accent"
              : "bg-panel border-white/10 hover:border-accent/40 text-white/80")
        }
        aria-label="Arm microphone"
      >
        ●
      </button>
      <div className="flex flex-col">
        <span className={"text-xs " + (mode === "error" ? "text-red-400" : "text-white/50")}>
          {label}
        </span>
        {heard && (
          <span className="text-xs text-white/30 italic max-w-sm truncate">heard: {heard}</span>
        )}
        {err && mode !== "error" && (
          <span className="text-xs text-yellow-400/70 italic max-w-sm truncate">{err}</span>
        )}
      </div>
    </div>
  );
});
