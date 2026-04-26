"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  title: string | null;
  summary: string | null;
  action_items: string | null;
  translate_to_english?: boolean;
  detected_language?: string | null;
}

interface CoachHint {
  id: string;
  text: string;
  source: "recall" | "context";
  createdAt: string;
}

const CHUNK_MS = 20_000; // 20s transcription chunks
const COACH_MS = 15_000; // coach tick cadence

interface SpeakBackState {
  phase: "recording" | "translating" | "playing" | "idle";
  english?: string;
  translated?: string;
  language?: string;
}

export function MeetingsHub() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live recording state.
  const [isRecording, setIsRecording] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<string[]>([]);
  const [hints, setHints] = useState<CoachHint[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [translate, setTranslate] = useState(false);
  const [detectedLang, setDetectedLang] = useState<string | null>(null);
  const [speakBack, setSpeakBack] = useState<SpeakBackState>({ phase: "idle" });
  const [speakError, setSpeakError] = useState<string | null>(null);

  const speakRecorderRef = useRef<MediaRecorder | null>(null);
  const speakChunksRef = useRef<BlobPart[]>([]);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const coachTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenHintIdsRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/meetings/list");
      if (!r.ok) {
        setError(`list failed (${r.status})`);
        return;
      }
      const d = (await r.json()) as { sessions: Session[]; active: Session | null };
      setSessions(d.sessions);
      setActive(d.active);
      if (d.active) sessionIdRef.current = d.active.id;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── recording lifecycle ───────────────────────────────────────────────────
  const uploadChunk = useCallback(async (blob: Blob) => {
    const sid = sessionIdRef.current;
    if (!sid || blob.size < 2000) return;
    const form = new FormData();
    form.append("session_id", sid);
    form.append("audio", blob, "chunk.webm");
    try {
      const r = await fetch("/api/meetings/chunk", { method: "POST", body: form });
      if (!r.ok) return;
      const d = (await r.json()) as { text?: string; language?: string | null };
      if (d.text) setLiveTranscript((prev) => [...prev.slice(-50), d.text!]);
      if (d.language && d.language !== "en") setDetectedLang(d.language);
    } catch {
      // Non-fatal: drop the chunk, keep recording.
    }
  }, []);

  const pollCoach = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      const r = await fetch("/api/meetings/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid }),
      });
      if (!r.ok) return;
      const d = (await r.json()) as { hint: CoachHint | null };
      if (d.hint && !seenHintIdsRef.current.has(d.hint.id)) {
        seenHintIdsRef.current.add(d.hint.id);
        setHints((prev) => [d.hint!, ...prev].slice(0, 8));
      }
    } catch {
      // Ignore coach errors — don't disrupt the recording.
    }
  }, []);

  // ── outbound speak-back (I speak English → they hear Russian) ────────────
  const decodeHeader = (b64: string | null): string => {
    if (!b64) return "";
    try {
      return typeof atob === "function"
        ? decodeURIComponent(escape(atob(b64)))
        : "";
    } catch {
      return "";
    }
  };

  const sendSpeakBack = useCallback(async (blob: Blob) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setSpeakBack({ phase: "translating" });
    setSpeakError(null);

    // Pause inbound capture while playback happens so we don't transcribe our
    // own speaker output.
    if (mediaRef.current && mediaRef.current.state === "recording") {
      try { mediaRef.current.pause(); } catch { /* ignore */ }
    }

    try {
      const form = new FormData();
      form.append("session_id", sid);
      form.append("audio", blob, "speak.webm");
      const r = await fetch("/api/meetings/speak", { method: "POST", body: form });
      if (!r.ok) {
        const msg = await r.text().catch(() => "");
        setSpeakError(msg || `speak failed (${r.status})`);
        setSpeakBack({ phase: "idle" });
        if (mediaRef.current && mediaRef.current.state === "paused") {
          try { mediaRef.current.resume(); } catch { /* ignore */ }
        }
        return;
      }
      const english = decodeHeader(r.headers.get("x-original-text"));
      const translated = decodeHeader(r.headers.get("x-translated-text"));
      const language = r.headers.get("x-target-language") ?? undefined;
      const mp3 = await r.blob();
      const url = URL.createObjectURL(mp3);

      setSpeakBack({ phase: "playing", english, translated, language });

      if (!audioElRef.current) audioElRef.current = new Audio();
      const el = audioElRef.current;
      el.src = url;
      el.onended = () => {
        URL.revokeObjectURL(url);
        setSpeakBack((s) => ({ ...s, phase: "idle" }));
        if (mediaRef.current && mediaRef.current.state === "paused") {
          try { mediaRef.current.resume(); } catch { /* ignore */ }
        }
      };
      el.onerror = () => {
        URL.revokeObjectURL(url);
        setSpeakError("playback failed");
        setSpeakBack((s) => ({ ...s, phase: "idle" }));
        if (mediaRef.current && mediaRef.current.state === "paused") {
          try { mediaRef.current.resume(); } catch { /* ignore */ }
        }
      };
      await el.play();
    } catch (e) {
      setSpeakError(e instanceof Error ? e.message : String(e));
      setSpeakBack({ phase: "idle" });
      if (mediaRef.current && mediaRef.current.state === "paused") {
        try { mediaRef.current.resume(); } catch { /* ignore */ }
      }
    }
  }, []);

  const startSpeaking = useCallback(() => {
    setSpeakError(null);
    const stream = streamRef.current;
    if (!stream) return;
    if (speakBack.phase !== "idle") return;
    speakChunksRef.current = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) speakChunksRef.current.push(ev.data);
    };
    rec.onstop = () => {
      const blob = new Blob(speakChunksRef.current, { type: mime });
      speakChunksRef.current = [];
      if (blob.size > 1000) void sendSpeakBack(blob);
      else setSpeakBack({ phase: "idle" });
    };
    speakRecorderRef.current = rec;
    setSpeakBack({ phase: "recording" });
    rec.start();
  }, [sendSpeakBack, speakBack.phase]);

  const stopSpeaking = useCallback(() => {
    const rec = speakRecorderRef.current;
    if (!rec) return;
    if (rec.state !== "inactive") {
      try { rec.stop(); } catch { /* ignore */ }
    }
    speakRecorderRef.current = null;
  }, []);

  const stopRecordingInternal = useCallback(() => {
    if (coachTimerRef.current) {
      clearInterval(coachTimerRef.current);
      coachTimerRef.current = null;
    }
    if (mediaRef.current && mediaRef.current.state !== "inactive") {
      try { mediaRef.current.stop(); } catch { /* ignore */ }
    }
    mediaRef.current = null;
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setStarting(true);
    try {
      // 1. Create a session on the server.
      const r = await fetch("/api/meetings/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ translate_to_english: translate }),
      });
      if (!r.ok) {
        setError(`start failed (${r.status})`);
        return;
      }
      const d = (await r.json()) as { session: Session };
      sessionIdRef.current = d.session.id;
      setActive(d.session);
      setDetectedLang(d.session.detected_language ?? null);

      // 2. Open the mic.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      mediaRef.current = rec;

      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) void uploadChunk(ev.data);
      };
      rec.onstop = () => {
        setIsRecording(false);
      };

      // Fire a dataavailable event every CHUNK_MS.
      rec.start(CHUNK_MS);
      setIsRecording(true);
      setLiveTranscript([]);
      setHints([]);
      seenHintIdsRef.current = new Set();

      coachTimerRef.current = setInterval(() => void pollCoach(), COACH_MS);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      stopRecordingInternal();
    } finally {
      setStarting(false);
    }
  }, [pollCoach, stopRecordingInternal, translate, uploadChunk]);

  const stopRecording = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setStopping(true);
    try {
      stopRecordingInternal();
      // Small delay so any pending dataavailable finishes uploading.
      await new Promise((res) => setTimeout(res, 800));
      const r = await fetch("/api/meetings/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid }),
      });
      if (!r.ok) {
        setError(`stop failed (${r.status})`);
        return;
      }
      sessionIdRef.current = null;
      setActive(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  }, [refresh, stopRecordingInternal]);

  // Make sure we release the mic if the user navigates away.
  useEffect(() => {
    return () => stopRecordingInternal();
  }, [stopRecordingInternal]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Meeting Ghost</h1>
            <p className="mt-1 text-sm text-white/60">
              Toggle on and JARVIS listens, transcribes, summarises, and files everything into recall.
            </p>
          </div>
          <Link href="/" className="text-xs text-white/60 hover:text-white/90">
            ← back to chat
          </Link>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        <section className="mb-10 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white/60">Status</div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${
                    isRecording ? "bg-red-500 animate-pulse" : "bg-white/30"
                  }`}
                />
                <span className="text-lg font-medium">
                  {isRecording ? "Listening…" : "Idle"}
                </span>
                {isRecording && translate && (
                  <span className="ml-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">
                    {detectedLang && detectedLang !== "en"
                      ? `${labelForLanguage(detectedLang)} → English`
                      : "Translate on · detecting…"}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={starting || stopping}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition disabled:opacity-40 ${
                isRecording
                  ? "bg-red-500 text-white hover:bg-red-400"
                  : "bg-white text-black hover:bg-white/90"
              }`}
            >
              {starting
                ? "Starting…"
                : stopping
                ? "Wrapping up…"
                : isRecording
                ? "Stop"
                : "Start meeting"}
            </button>
          </div>

          {!isRecording && (
            <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={translate}
                onChange={(e) => setTranslate(e.target.checked)}
                className="h-3.5 w-3.5 accent-amber-400"
              />
              Auto-translate to English (for international calls)
            </label>
          )}

          {isRecording && (
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-[1fr_280px]">
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-white/40">Live transcript</div>
                <div className="max-h-64 overflow-y-auto rounded-md border border-white/10 bg-black/40 p-3 text-sm text-white/80">
                  {liveTranscript.length === 0 ? (
                    <span className="text-white/30">…</span>
                  ) : (
                    liveTranscript.map((t, i) => <span key={i}>{t} </span>)
                  )}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-white/40">Coach whispers</div>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {hints.length === 0 ? (
                    <div className="rounded-md border border-white/10 bg-black/40 p-3 text-xs text-white/30">
                      Listening for moments where a fact from your history would help…
                    </div>
                  ) : (
                    hints.map((h) => (
                      <div
                        key={h.id}
                        className="rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100"
                      >
                        {h.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {isRecording && translate && detectedLang && detectedLang !== "en" && (
            <div className="mt-6 rounded-xl border border-sky-400/30 bg-sky-400/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-sky-100">Speak back in {labelForLanguage(detectedLang)}</div>
                  <div className="text-[11px] text-sky-200/70">
                    Hold the button, speak English, release to play {labelForLanguage(detectedLang)} out loud. Headphones recommended.
                  </div>
                </div>
                {speakBack.phase === "playing" && (
                  <span className="rounded-full border border-sky-300/40 bg-sky-300/10 px-2 py-0.5 text-[10px] text-sky-100">
                    playing…
                  </span>
                )}
                {speakBack.phase === "translating" && (
                  <span className="rounded-full border border-sky-300/40 bg-sky-300/10 px-2 py-0.5 text-[10px] text-sky-100">
                    translating…
                  </span>
                )}
              </div>
              <button
                onMouseDown={startSpeaking}
                onMouseUp={stopSpeaking}
                onMouseLeave={speakBack.phase === "recording" ? stopSpeaking : undefined}
                onTouchStart={(e) => { e.preventDefault(); startSpeaking(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopSpeaking(); }}
                disabled={speakBack.phase === "translating" || speakBack.phase === "playing"}
                className={`w-full rounded-lg px-4 py-3 text-sm font-semibold transition disabled:opacity-50 ${
                  speakBack.phase === "recording"
                    ? "bg-sky-400 text-black"
                    : "bg-sky-500/90 text-white hover:bg-sky-500"
                }`}
              >
                {speakBack.phase === "recording"
                  ? "● Recording — release to send"
                  : speakBack.phase === "translating"
                  ? "Translating…"
                  : speakBack.phase === "playing"
                  ? "Playing back…"
                  : "Hold to speak"}
              </button>
              {speakBack.english && (
                <div className="mt-3 space-y-1 text-xs">
                  <div className="text-white/60">
                    <span className="text-white/40">You:</span> {speakBack.english}
                  </div>
                  <div className="text-sky-200">
                    <span className="text-sky-300/60">{speakBack.language?.toUpperCase()}:</span> {speakBack.translated}
                  </div>
                </div>
              )}
              {speakError && (
                <div className="mt-2 text-[11px] text-red-300">{speakError}</div>
              )}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-white/80">Past meetings</h2>
            <button onClick={refresh} className="text-xs text-white/50 hover:text-white/80">
              refresh
            </button>
          </div>
          {loading ? (
            <div className="text-sm text-white/40">Loading…</div>
          ) : sessions.length === 0 ? (
            <div className="rounded-md border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/40">
              No meetings yet. Hit Start when you're in a conversation you want remembered.
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <SessionCard key={s.id} session={s} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  es: "Spanish",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
  nl: "Dutch",
  zh: "Chinese",
  ja: "Japanese",
  ko: "Korean",
  ar: "Arabic",
  hi: "Hindi",
  ru: "Russian",
  tr: "Turkish",
  pl: "Polish",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  el: "Greek",
  he: "Hebrew",
};

function labelForLanguage(code: string): string {
  const normalised = code.toLowerCase().slice(0, 2);
  return LANGUAGE_LABELS[normalised] ?? code.toUpperCase();
}

function SessionCard({ session }: { session: Session }) {
  const started = new Date(session.started_at);
  const ended = session.ended_at ? new Date(session.ended_at) : null;
  const duration = ended ? Math.round((ended.getTime() - started.getTime()) / 60000) : null;
  return (
    <Link
      href={`/meetings/${session.id}`}
      className="block rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/30"
    >
      <div className="flex items-center justify-between text-[11px] text-white/50">
        <span>
          {started.toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
          {duration != null && ` · ${duration} min`}
        </span>
        {!session.ended_at && <span className="text-red-400">live</span>}
      </div>
      <div className="mt-1 font-medium">{session.title ?? "(in progress)"}</div>
      {session.summary && (
        <div className="mt-1 line-clamp-2 text-sm text-white/70">{session.summary}</div>
      )}
    </Link>
  );
}
