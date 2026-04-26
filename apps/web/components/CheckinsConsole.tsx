"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type CheckinRow = {
  id: string;
  log_date: string;
  energy: number | null;
  mood: number | null;
  focus: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

type SeriesPoint = {
  date: string;
  energy: number | null;
  mood: number | null;
  focus: number | null;
};

type Metric = "energy" | "mood" | "focus";

const METRIC_LABEL: Record<Metric, string> = {
  energy: "Energy",
  mood: "Mood",
  focus: "Focus",
};

const METRIC_COLOR: Record<Metric, string> = {
  energy: "#7affcb",
  mood: "#f4c9d8",
  focus: "#bfd4ee",
};

function todayLocalYMD(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shortDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] ?? "";
}

export function CheckinsConsole() {
  const [today, setToday] = useState<CheckinRow | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [rows, setRows] = useState<CheckinRow[]>([]);
  const [energy, setEnergy] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/checkins?days=30", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        today: CheckinRow | null;
        rows: CheckinRow[];
        series: SeriesPoint[];
      };
      setToday(j.today);
      setRows(j.rows ?? []);
      setSeries(j.series ?? []);
      setEnergy(j.today?.energy ?? null);
      setMood(j.today?.mood ?? null);
      setFocus(j.today?.focus ?? null);
      setNote(j.today?.note ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/checkins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          log_date: todayLocalYMD(),
          energy,
          mood,
          focus,
          note: note.trim() || null,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      setSavedAt(Date.now());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [energy, mood, focus, note, load]);

  // Auto-save 800ms after any rating change (gives Reiss instant feedback
  // without an explicit Save button — the note field uses the explicit one).
  useEffect(() => {
    if (loading) return;
    const sameAsLoaded =
      energy === (today?.energy ?? null) &&
      mood === (today?.mood ?? null) &&
      focus === (today?.focus ?? null);
    if (sameAsLoaded) return;
    const id = setTimeout(() => void save(), 600);
    return () => clearTimeout(id);
  }, [energy, mood, focus, loading, today, save]);

  const summary = useMemo(() => {
    const filled = rows.filter((r) => r.energy || r.mood || r.focus);
    const avg = (key: Metric) => {
      const vs = filled.map((r) => r[key]).filter((v): v is number => typeof v === "number");
      if (vs.length === 0) return null;
      return vs.reduce((a, b) => a + b, 0) / vs.length;
    };
    return {
      energy: avg("energy"),
      mood: avg("mood"),
      focus: avg("focus"),
      count: filled.length,
    };
  }, [rows]);

  const lastSavedLabel = savedAt
    ? `saved ${Math.max(1, Math.round((Date.now() - savedAt) / 1000))}s ago`
    : today
    ? "logged earlier today"
    : "not logged yet";

  return (
    <div
      style={{
        padding: "28px 32px 48px",
        maxWidth: 760,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div
        style={{
          padding: "24px 26px",
          borderRadius: 16,
          background: "var(--panel)",
          border: "1px solid var(--rule)",
          display: "flex",
          flexDirection: "column",
          gap: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 22,
              color: "var(--ink)",
            }}
          >
            How are you today?
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: 1.4,
              textTransform: "uppercase",
              color: saving ? "var(--ink-2)" : "var(--ink-3)",
            }}
          >
            {saving ? "Saving…" : lastSavedLabel}
          </span>
        </div>

        <RatingRow
          label="Energy"
          color={METRIC_COLOR.energy}
          value={energy}
          onChange={setEnergy}
        />
        <RatingRow
          label="Mood"
          color={METRIC_COLOR.mood}
          value={mood}
          onChange={setMood}
        />
        <RatingRow
          label="Focus"
          color={METRIC_COLOR.focus}
          value={focus}
          onChange={setFocus}
        />

        <div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="One line about today (optional)"
            rows={2}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 10,
              background: "var(--bg)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 14,
              lineHeight: 1.5,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: "7px 16px",
                borderRadius: 8,
                background: "transparent",
                color: "var(--ink-2)",
                border: "1px solid var(--rule)",
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                cursor: saving ? "default" : "pointer",
              }}
            >
              Save note
            </button>
          </div>
        </div>

        {error && (
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "#ff6b6b" }}>{error}</div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <Sparkline metric="energy" series={series} avg={summary.energy} />
        <Sparkline metric="mood" series={series} avg={summary.mood} />
        <Sparkline metric="focus" series={series} avg={summary.focus} />
      </div>

      {summary.count === 0 && !loading && (
        <div
          style={{
            padding: "20px 24px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 16,
            color: "var(--ink-3)",
            border: "1px dashed var(--rule)",
            borderRadius: 12,
          }}
        >
          Tap a number above to log your first check-in.
        </div>
      )}
    </div>
  );
}

function RatingRow({
  label,
  color,
  value,
  onChange,
}: {
  label: string;
  color: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: "var(--ink-3)",
          minWidth: 64,
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: 6, flex: 1 }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n;
          return (
            <button
              key={n}
              onClick={() => onChange(active ? null : n)}
              style={{
                flex: 1,
                padding: "12px 0",
                borderRadius: 10,
                background: active ? color : "transparent",
                color: active ? "#000" : "var(--ink-2)",
                border: `1px solid ${active ? color : "var(--rule)"}`,
                fontFamily: "var(--mono)",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                transition: "background 150ms",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Sparkline({
  metric,
  series,
  avg,
}: {
  metric: Metric;
  series: SeriesPoint[];
  avg: number | null;
}) {
  const color = METRIC_COLOR[metric];
  const label = METRIC_LABEL[metric];
  const w = 600;
  const h = 70;
  const pad = 4;
  const len = series.length || 1;
  const points = series
    .map((p, i) => {
      const v = p[metric];
      if (v == null) return null;
      const x = pad + ((w - 2 * pad) * i) / (len - 1 || 1);
      const y = h - pad - ((h - 2 * pad) * (v - 1)) / 4;
      return { x, y, date: p.date, value: v };
    })
    .filter((p): p is { x: number; y: number; date: string; value: number } => p !== null);

  // Group consecutive points into segments so gaps render as breaks
  const segments: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  let lastIdx = -2;
  series.forEach((p, i) => {
    if (p[metric] == null) {
      if (cur.length > 0) segments.push(cur);
      cur = [];
      return;
    }
    if (i !== lastIdx + 1 && cur.length > 0) {
      segments.push(cur);
      cur = [];
    }
    const x = pad + ((w - 2 * pad) * i) / (len - 1 || 1);
    const y = h - pad - ((h - 2 * pad) * (p[metric]! - 1)) / 4;
    cur.push({ x, y });
    lastIdx = i;
  });
  if (cur.length > 0) segments.push(cur);

  return (
    <div
      style={{
        padding: "16px 20px",
        borderRadius: 14,
        background: "var(--panel)",
        border: "1px solid var(--rule)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            color: "var(--ink-3)",
          }}
        >
          {label} · 30d
        </span>
        <span
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 16,
            color: "var(--ink)",
          }}
        >
          {avg != null ? `avg ${avg.toFixed(1)}` : "—"}
        </span>
      </div>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
        {[1, 2, 3, 4, 5].map((n) => {
          const y = h - pad - ((h - 2 * pad) * (n - 1)) / 4;
          return (
            <line
              key={n}
              x1={pad}
              x2={w - pad}
              y1={y}
              y2={y}
              stroke="var(--rule)"
              strokeWidth={n === 3 ? 1 : 0.5}
              strokeDasharray={n === 3 ? "" : "2 4"}
              opacity={0.5}
            />
          );
        })}
        {segments.map((seg, idx) => (
          <polyline
            key={idx}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
          />
        ))}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color}>
            <title>
              {shortDay(p.date)} {p.date}: {p.value}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
