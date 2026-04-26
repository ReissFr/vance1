"use client";

// JARVIS avatar console — holographic 3D avatar (Ready Player Me via three.js)
// with a glassmorphism dashboard overlay. Voice loop: hold mic → MediaRecorder
// → /api/stt (Groq) → /api/agent (SSE brain) → /api/tts (ElevenLabs) → play.
// Mouth morph targets are driven by an AudioContext analyser on the playback
// element so lip movement matches ElevenLabs audio in real time.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Canvas touches the DOM / WebGL, so disable SSR for the three.js layer.
const HolographicAvatar = dynamic(
  () => import("./avatar/HolographicAvatar").then((m) => m.HolographicAvatar),
  { ssr: false },
);

interface WeatherSnapshot {
  label: string;
  temperature_c: number | null;
  conditions: string | null;
  emoji: string;
}

interface ReminderItem {
  id: string;
  title: string;
  scheduledAt: string | null;
}

interface NewsItem {
  id: string;
  title: string;
  source: string | null;
  url: string;
}

const DEFAULT_LAT = 51.5474;
const DEFAULT_LON = -0.0551;
const DEFAULT_LOCATION_LABEL = "East London";

const WEATHER_EMOJI: Record<number, string> = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️",
  45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌧️",
  61: "🌧️", 63: "🌧️", 65: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "❄️",
  80: "🌦️", 81: "🌧️", 82: "⛈️",
  95: "⛈️", 96: "⛈️", 99: "⛈️",
};

const INSPIRATION_QUOTES = [
  `"The future belongs to those who prepare for it today." — Malcolm X`,
  `"AI is going to make us work more productively, live longer, and have cleaner energy." — Fei-Fei Li`,
  `"The best way to predict the future is to invent it." — Alan Kay`,
  `"Simplicity is the ultimate sophistication." — Leonardo da Vinci`,
];

type Status = "idle" | "listening" | "thinking" | "speaking";

export function AvatarConsole() {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [quote, setQuote] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [lastSaid, setLastSaid] = useState<string>("");
  const [lastReply, setLastReply] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const micStreamRef = useRef<MediaStream | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => setWeather(await fetchWeather()))();
    (async () => setReminders(await fetchReminders()))();
    (async () => setNews(await fetchNews()))();
    (async () => {
      const b = await fetchBriefing();
      setQuote(b.quote ?? randomQuote());
      if (b.displayName) setDisplayName(b.displayName);
    })();
  }, []);

  const tickAudioLevel = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) {
      rafRef.current = null;
      return;
    }
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    // RMS on the 8-bit PCM range (128 = silence).
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    // Map RMS → 0..1 with a floor so quiet speech still opens the mouth.
    const level = Math.min(1, rms * 3.5);
    setAudioLevel(level);
    rafRef.current = requestAnimationFrame(tickAudioLevel);
  }, []);

  const teardownPlayback = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setAudioLevel(0);
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.disconnect(); } catch {}
      sourceNodeRef.current = null;
    }
    analyserRef.current = null;
    if (playbackAudioRef.current) {
      try { playbackAudioRef.current.pause(); } catch {}
      playbackAudioRef.current = null;
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    setStatus("speaking");
    setLastReply(text);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);
      audio.crossOrigin = "anonymous";
      playbackAudioRef.current = audio;

      // Create or reuse AudioContext (Chrome requires it after user gesture;
      // we only ever call speak() after a mic interaction so we're safe).
      if (!audioCtxRef.current) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new Ctor();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      sourceNodeRef.current = source;

      await new Promise<void>((resolve, reject) => {
        audio.addEventListener("ended", () => resolve(), { once: true });
        audio.addEventListener("error", () => reject(new Error("audio playback failed")), { once: true });
        audio.play().catch(reject);
        rafRef.current = requestAnimationFrame(tickAudioLevel);
      });
      URL.revokeObjectURL(url);
    } finally {
      teardownPlayback();
      setStatus("idle");
    }
  }, [tickAudioLevel, teardownPlayback]);

  const askBrain = useCallback(async (message: string) => {
    setStatus("thinking");
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        deviceKind: "web",
        ...(conversationIdRef.current ? { conversationId: conversationIdRef.current } : {}),
      }),
    });
    if (!res.ok || !res.body) throw new Error(`agent ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    // Parse the SSE stream, collecting text_delta events.
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const evt = JSON.parse(line.slice(6)) as { type: string; text?: string; id?: string; error?: string };
          if (evt.type === "conversation" && evt.id) conversationIdRef.current = evt.id;
          else if (evt.type === "text_delta" && evt.text) full += evt.text;
          else if (evt.type === "error" && evt.error) throw new Error(evt.error);
        } catch {
          // Swallow per-frame parse errors; stream may carry partial events.
        }
      }
    }

    const trimmed = full.trim();
    if (!trimmed) throw new Error("empty reply");
    return trimmed;
  }, []);

  const startListening = useCallback(async () => {
    if (status !== "idle") return;
    setErrorMsg(null);
    try {
      // Tear down any in-flight playback first (press mic to interrupt JARVIS).
      teardownPlayback();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.start();
      setStatus("listening");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "mic unavailable");
    }
  }, [status, teardownPlayback]);

  const stopListening = useCallback(async () => {
    const mr = mediaRecorderRef.current;
    const stream = micStreamRef.current;
    if (!mr || mr.state === "inactive") return;

    await new Promise<void>((resolve) => {
      mr.addEventListener("stop", () => resolve(), { once: true });
      mr.stop();
    });
    stream?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;

    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    audioChunksRef.current = [];

    try {
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      const sttRes = await fetch("/api/stt", { method: "POST", body: form });
      if (!sttRes.ok) throw new Error(`stt ${sttRes.status}`);
      const { text } = (await sttRes.json()) as { text?: string };
      const said = (text ?? "").trim();
      if (!said) {
        setStatus("idle");
        return;
      }
      setLastSaid(said);
      const reply = await askBrain(said);
      await speak(reply);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "voice loop failed");
      setStatus("idle");
    }
  }, [askBrain, speak]);

  // Release mic + audio on unmount so we don't leak hardware.
  useEffect(() => {
    return () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      teardownPlayback();
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    };
  }, [teardownPlayback]);

  const greeting = useMemo(() => timeGreeting(now), [now]);
  const firstName = (displayName ?? "").trim().split(/\s+/)[0] || "Reiss";
  const clock = useMemo(() => formatClock(now), [now]);

  const speaking = status === "speaking";

  return (
    <div className="relative min-h-screen overflow-hidden bg-black text-white">
      {/* Background wash */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#020617] via-[#020c24] to-black" />
      <div className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(ellipse_at_center,rgba(30,162,255,0.25),transparent_60%)]" />

      {/* 3D avatar layer */}
      <div className="absolute inset-0">
        <HolographicAvatar audioLevel={audioLevel} speaking={speaking} />
      </div>

      {/* Dashboard overlay */}
      <div className="pointer-events-none absolute inset-0 p-6 md:p-10">
        <div className="grid h-full grid-cols-12 gap-4">
          <div className="col-span-4 flex flex-col gap-4">
            <Card>
              <div className="text-sm opacity-70">{clock}</div>
              <div className="mt-1 text-2xl font-semibold">
                {greeting}, {firstName}!
              </div>
              {quote && <div className="mt-3 text-xs italic opacity-70">{quote}</div>}
            </Card>

            <Card>
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide opacity-60">
                <span>Reminders</span>
                <span>+</span>
              </div>
              {reminders.length === 0 ? (
                <div className="text-xs opacity-50">Nothing on your list.</div>
              ) : (
                <ul className="space-y-2 text-sm">
                  {reminders.slice(0, 4).map((r) => (
                    <li key={r.id} className="flex items-start gap-2">
                      <span className="mt-1 h-3 w-3 flex-shrink-0 rounded-sm border border-white/40" />
                      <div>
                        <div>{r.title}</div>
                        {r.scheduledAt && (
                          <div className="text-[10px] opacity-50">{formatScheduled(r.scheduledAt)}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="col-span-4" />

          <div className="col-span-4 flex flex-col gap-4">
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-semibold">
                    {weather?.emoji ?? "…"}{" "}
                    {weather?.temperature_c != null
                      ? `${Math.round(weather.temperature_c)}°C`
                      : "—"}
                  </div>
                  <div className="text-xs opacity-60">{weather?.label ?? DEFAULT_LOCATION_LABEL}</div>
                </div>
                <div className="text-xs opacity-50">{weather?.conditions ?? ""}</div>
              </div>
            </Card>

            <Card>
              <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide opacity-60">
                <span>For You</span>
              </div>
              {news.length === 0 ? (
                <div className="text-xs opacity-50">Loading headlines…</div>
              ) : (
                <ul className="space-y-3 text-sm">
                  {news.slice(0, 3).map((n) => (
                    <li key={n.id} className="pointer-events-auto">
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="group block">
                        <div className="line-clamp-2 group-hover:underline">{n.title}</div>
                        {n.source && <div className="mt-1 text-[10px] opacity-50">{n.source}</div>}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>

      {/* Bottom bar: transcript + mic button + status */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-6 md:p-8">
        {lastSaid && (
          <div className="pointer-events-auto max-w-xl rounded-2xl border border-white/10 bg-black/40 px-4 py-2 text-center text-sm opacity-80 backdrop-blur-xl">
            <span className="opacity-60">You:</span> {lastSaid}
          </div>
        )}
        {lastReply && status === "speaking" && (
          <div className="pointer-events-auto max-w-xl rounded-2xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-center text-sm backdrop-blur-xl">
            {lastReply}
          </div>
        )}
        {errorMsg && (
          <div className="pointer-events-auto max-w-xl rounded-xl border border-red-400/40 bg-red-500/20 px-3 py-1 text-xs">
            {errorMsg}
          </div>
        )}
        <button
          type="button"
          className={`pointer-events-auto flex h-20 w-20 items-center justify-center rounded-full border backdrop-blur-xl transition ${
            status === "listening"
              ? "scale-110 border-red-400 bg-red-500/30"
              : status === "thinking"
              ? "border-yellow-400/60 bg-yellow-500/20"
              : status === "speaking"
              ? "border-cyan-400/60 bg-cyan-500/20"
              : "border-white/30 bg-white/10 hover:bg-white/20"
          }`}
          onPointerDown={startListening}
          onPointerUp={stopListening}
          onPointerLeave={() => { if (status === "listening") void stopListening(); }}
          aria-label="Hold to talk"
        >
          <MicIcon className="h-8 w-8" />
        </button>
        <div className="text-xs uppercase tracking-wider opacity-60">
          {status === "idle" && "Hold to speak"}
          {status === "listening" && "Listening…"}
          {status === "thinking" && "Thinking…"}
          {status === "speaking" && "Speaking"}
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto rounded-2xl border border-white/10 bg-black/40 p-4 shadow-lg backdrop-blur-xl">
      {children}
    </div>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x={9} y={3} width={6} height={12} rx={3} />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function timeGreeting(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Good Evening";
  if (h < 12) return "Good Morning";
  if (h < 18) return "Good Afternoon";
  return "Good Evening";
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatScheduled(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function randomQuote(): string {
  const pick = INSPIRATION_QUOTES[Math.floor(Math.random() * INSPIRATION_QUOTES.length)];
  return pick ?? INSPIRATION_QUOTES[0] ?? "";
}

async function fetchWeather(): Promise<WeatherSnapshot> {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${DEFAULT_LAT}&longitude=${DEFAULT_LON}&current=temperature_2m,weather_code`,
    );
    const d = (await r.json()) as { current?: { temperature_2m: number; weather_code: number } };
    if (!d.current) throw new Error("no current weather");
    return {
      label: DEFAULT_LOCATION_LABEL,
      temperature_c: d.current.temperature_2m,
      conditions: weatherLabel(d.current.weather_code),
      emoji: WEATHER_EMOJI[d.current.weather_code] ?? "🌡️",
    };
  } catch {
    return { label: DEFAULT_LOCATION_LABEL, temperature_c: null, conditions: null, emoji: "🌡️" };
  }
}

function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 3) return "Cloud";
  if (code <= 48) return "Fog";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 99) return "Storm";
  return "";
}

async function fetchReminders(): Promise<ReminderItem[]> {
  try {
    const r = await fetch("/api/home/feed", { cache: "no-store" });
    if (!r.ok) return [];
    const j = (await r.json()) as { upcoming?: { id: string; title: string; at?: string }[] };
    return (j.upcoming ?? []).slice(0, 5).map((t) => ({
      id: t.id,
      title: t.title,
      scheduledAt: t.at ?? null,
    }));
  } catch {
    return [];
  }
}

async function fetchBriefing(): Promise<{ quote: string | null; displayName: string | null }> {
  try {
    const r = await fetch("/api/briefing/latest", { cache: "no-store" });
    if (!r.ok) return { quote: null, displayName: null };
    const j = (await r.json()) as { display_name?: string | null };
    return { quote: null, displayName: j.display_name ?? null };
  } catch {
    return { quote: null, displayName: null };
  }
}

async function fetchNews(): Promise<NewsItem[]> {
  try {
    const r = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
    const ids = (await r.json()) as number[];
    const top = ids.slice(0, 3);
    const items = await Promise.all(
      top.map(async (id) => {
        const ir = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        return (await ir.json()) as { id: number; title?: string; url?: string; by?: string };
      }),
    );
    return items
      .filter((i) => i.title && i.url)
      .map((i) => ({
        id: String(i.id),
        title: i.title ?? "",
        source: i.by ?? null,
        url: i.url ?? "",
      }));
  } catch {
    return [];
  }
}
