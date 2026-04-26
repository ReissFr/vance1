"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PRESETS: { label: string; minutes: number }[] = [
  { label: "15", minutes: 15 },
  { label: "25", minutes: 25 },
  { label: "45", minutes: 45 },
  { label: "60", minutes: 60 },
  { label: "90", minutes: 90 },
];

const LS_KEY = "jarvis.focus.session.v1";

type SavedSession = {
  endsAt: number;
  totalSec: number;
  topic: string;
  sessionId?: string | null;
};

type DayStat = { date: string; minutes: number };
type Stats = {
  last_7_days: DayStat[];
  week_minutes: number;
  today_minutes: number;
};

function formatClock(secs: number): string {
  const m = Math.max(0, Math.floor(secs / 60));
  const s = Math.max(0, Math.floor(secs % 60));
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function weekdayShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()] ?? "";
}

export function FocusConsole() {
  const [topic, setTopic] = useState("");
  const [durationMin, setDurationMin] = useState(25);
  const [session, setSession] = useState<SavedSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [snoozeError, setSnoozeError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const completedRef = useRef(false);
  const completedLoggedRef = useRef(false);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch("/api/focus/sessions", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as Stats;
      setStats(data);
    } catch {
      // soft-fail
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // Hydrate from local storage so a reload during a session recovers.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as SavedSession;
      if (parsed?.endsAt && parsed.endsAt > Date.now()) {
        setSession(parsed);
      } else {
        localStorage.removeItem(LS_KEY);
      }
    } catch {
      localStorage.removeItem(LS_KEY);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [session]);

  // Detect completion, play a soft bell, log the session once.
  useEffect(() => {
    if (!session) return;
    if (now < session.endsAt) {
      completedRef.current = false;
      return;
    }
    if (completedRef.current) return;
    completedRef.current = true;

    // Persist the natural completion (once — guarded by ref).
    if (!completedLoggedRef.current && session.sessionId) {
      completedLoggedRef.current = true;
      void (async () => {
        try {
          await fetch(`/api/focus/sessions/${session.sessionId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              actual_seconds: session.totalSec,
              completed_fully: true,
            }),
          });
          void loadStats();
        } catch {
          // soft-fail — next Stop will PATCH anyway
        }
      })();
    }

    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 660;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
      osc.stop(ctx.currentTime + 1.3);
    } catch {
      // audio might be blocked — fine
    }
  }, [session, now, loadStats]);

  const remaining = session ? Math.max(0, (session.endsAt - now) / 1000) : 0;
  const done = session && remaining <= 0;
  const progress = session ? 1 - remaining / session.totalSec : 0;

  const start = useCallback(async () => {
    setSnoozeError(null);
    const totalSec = durationMin * 60;
    const endsAt = Date.now() + totalSec * 1000;
    const trimmedTopic = topic.trim();

    // Fire both calls in parallel: mute proactive + register the session.
    const [muteRes, sessRes] = await Promise.allSettled([
      fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proactive_snoozed_until: new Date(endsAt).toISOString(),
        }),
      }),
      fetch("/api/focus/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          planned_seconds: totalSec,
          topic: trimmedTopic || null,
        }),
      }),
    ]);

    if (muteRes.status === "rejected" || (muteRes.status === "fulfilled" && !muteRes.value.ok)) {
      setSnoozeError(
        muteRes.status === "rejected"
          ? `Started locally, but couldn't mute proactive: ${muteRes.reason}`
          : `Started locally, but couldn't mute proactive (${muteRes.value.status})`,
      );
    }

    let sessionId: string | null = null;
    if (sessRes.status === "fulfilled" && sessRes.value.ok) {
      try {
        const body = (await sessRes.value.json()) as { session?: { id?: string } };
        sessionId = body.session?.id ?? null;
      } catch {
        // soft-fail — we keep the local session; logging just won't happen
      }
    }

    const next: SavedSession = {
      endsAt,
      totalSec,
      topic: trimmedTopic,
      sessionId,
    };
    setSession(next);
    completedRef.current = false;
    completedLoggedRef.current = false;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      // soft-fail
    }
  }, [durationMin, topic]);

  const stop = useCallback(async () => {
    const s = session;
    setSession(null);
    completedRef.current = false;
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      // soft-fail
    }

    const elapsedSec = s ? Math.min(s.totalSec, Math.max(0, (Date.now() - (s.endsAt - s.totalSec * 1000)) / 1000)) : 0;
    const wasDone = s ? Date.now() >= s.endsAt : false;

    await Promise.allSettled([
      fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proactive_snoozed_until: null }),
      }),
      s?.sessionId && !completedLoggedRef.current
        ? fetch(`/api/focus/sessions/${s.sessionId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              actual_seconds: Math.round(elapsedSec),
              completed_fully: wasDone,
            }),
          })
        : Promise.resolve(),
    ]);

    void loadStats();
  }, [session, loadStats]);

  const timeLabel = useMemo(
    () => (session ? formatClock(remaining) : formatClock(durationMin * 60)),
    [session, remaining, durationMin],
  );

  const maxDay = useMemo(() => {
    if (!stats?.last_7_days?.length) return 0;
    return Math.max(...stats.last_7_days.map((d) => d.minutes), 1);
  }, [stats]);

  return (
    <div
      style={{
        padding: "48px 32px",
        maxWidth: 760,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 32,
      }}
    >
      <FocusRing progress={session ? progress : 0} size={320} label={timeLabel} />

      {session ? (
        <>
          {session.topic && (
            <div
              style={{
                fontFamily: "var(--serif)",
                fontSize: 22,
                fontStyle: "italic",
                color: "var(--ink)",
                textAlign: "center",
                maxWidth: 600,
              }}
            >
              {session.topic}
            </div>
          )}
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: done ? "#7affcb" : "var(--ink-3)",
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            {done ? "Done — breathe, then start the next block." : "Focus mode · proactive muted"}
          </div>
          <button
            onClick={stop}
            style={{
              padding: "12px 28px",
              borderRadius: 10,
              background: "transparent",
              color: "var(--ink-2)",
              border: "1px solid var(--rule)",
              fontFamily: "var(--sans)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {done ? "Finish" : "Stop early"}
          </button>
          {snoozeError && (
            <div
              style={{
                color: "#ff6b6b",
                fontFamily: "var(--mono)",
                fontSize: 11,
                textAlign: "center",
              }}
            >
              {snoozeError}
            </div>
          )}
        </>
      ) : (
        <>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What are you focusing on? (optional)"
            style={{
              width: "100%",
              maxWidth: 540,
              padding: "12px 16px",
              borderRadius: 12,
              background: "var(--panel)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 18,
              textAlign: "center",
            }}
          />
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {PRESETS.map((p) => (
              <button
                key={p.minutes}
                onClick={() => setDurationMin(p.minutes)}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  background: durationMin === p.minutes ? "var(--ink)" : "transparent",
                  color: durationMin === p.minutes ? "#000" : "var(--ink-2)",
                  border: `1px solid ${durationMin === p.minutes ? "var(--ink)" : "var(--rule)"}`,
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  cursor: "pointer",
                  minWidth: 56,
                }}
              >
                {p.label}m
              </button>
            ))}
          </div>
          <button
            onClick={start}
            style={{
              padding: "14px 40px",
              borderRadius: 12,
              background: "#7affcb",
              color: "#000",
              border: "none",
              fontFamily: "var(--sans)",
              fontSize: 15,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Start focus
          </button>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
              textAlign: "center",
              maxWidth: 460,
              lineHeight: 1.6,
            }}
          >
            Proactive nudges mute for the block. A soft bell signals the end.
          </div>
        </>
      )}

      {stats && stats.last_7_days.length > 0 && (
        <div
          style={{
            width: "100%",
            maxWidth: 540,
            marginTop: 8,
            padding: "20px 24px",
            borderRadius: 14,
            background: "var(--panel)",
            border: "1px solid var(--rule)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: 1.4,
                textTransform: "uppercase",
                color: "var(--ink-3)",
              }}
            >
              Deep work · last 7 days
            </span>
            <span
              style={{
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 18,
                color: "var(--ink)",
              }}
            >
              {formatDuration(stats.week_minutes)}
              {stats.today_minutes > 0 && (
                <span style={{ color: "var(--ink-3)", fontSize: 13, marginLeft: 10 }}>
                  · {formatDuration(stats.today_minutes)} today
                </span>
              )}
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 8,
              alignItems: "end",
              height: 80,
            }}
          >
            {stats.last_7_days.map((d) => {
              const h = maxDay > 0 ? Math.max(3, (d.minutes / maxDay) * 72) : 3;
              return (
                <div
                  key={d.date}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <div
                    title={`${d.minutes} min on ${d.date}`}
                    style={{
                      width: "100%",
                      height: h,
                      background: d.minutes > 0 ? "#7affcb" : "var(--rule)",
                      borderRadius: 4,
                      transition: "height 200ms",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 9.5,
                      color: "var(--ink-3)",
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                    }}
                  >
                    {weekdayShort(d.date)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function FocusRing({
  progress,
  size,
  label,
}: {
  progress: number;
  size: number;
  label: string;
}) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(1, progress)));

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--rule)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#7affcb"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 400ms linear" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--mono)",
          fontSize: 58,
          letterSpacing: 2,
          color: "var(--ink)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {label}
      </div>
    </div>
  );
}
