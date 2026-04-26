"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Severity = "high" | "medium" | "low";

type Pointer = { id: string; text: string; date: string; href: string };

type SignalKind =
  | "intention_unmatched"
  | "decision_silent"
  | "goal_stalled"
  | "prediction_overdue"
  | "commitment_overdue"
  | "habit_missed"
  | "focus_underperformed"
  | "theme_dormant";

type Signal = {
  kind: SignalKind;
  severity: Severity;
  said: Pointer;
  did: Pointer | null;
  gap_days?: number;
  note?: string;
};

type Resp = {
  window_days: number;
  total_signals: number;
  total_said: number;
  by_kind: Record<string, number>;
  signals: Signal[];
};

type WindowChoice = "7d" | "30d" | "90d";

const KIND_LABEL: Record<SignalKind, string> = {
  intention_unmatched: "Intention with no echo",
  decision_silent: "Decision with no follow-up",
  goal_stalled: "Goal stalled",
  prediction_overdue: "Prediction overdue",
  commitment_overdue: "Commitment overdue",
  habit_missed: "Habit short of target",
  focus_underperformed: "Focus undershot",
  theme_dormant: "Theme dormant",
};

const KIND_COLOR: Record<SignalKind, string> = {
  intention_unmatched: "#f4a3a3",
  decision_silent: "#e3b27c",
  goal_stalled: "#bfd4ee",
  prediction_overdue: "#cdb6ff",
  commitment_overdue: "#fbb86d",
  habit_missed: "#7affcb",
  focus_underperformed: "#ffd76b",
  theme_dormant: "#bfbfbf",
};

const SEVERITY_BG: Record<Severity, string> = {
  high: "#3a1414",
  medium: "#3a2a14",
  low: "#1f1f1f",
};

const SEVERITY_BORDER: Record<Severity, string> = {
  high: "#a14040",
  medium: "#a07a40",
  low: "#3a3a3a",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

export function ReconcileConsole() {
  const [resp, setResp] = useState<Resp | null>(null);
  const [windowChoice, setWindowChoice] = useState<WindowChoice>("30d");
  const [kindFilter, setKindFilter] = useState<SignalKind | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/reconcile/journal?window=${windowChoice}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setResp(j as Resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [windowChoice]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!resp) return [] as Signal[];
    if (kindFilter === "all") return resp.signals;
    return resp.signals.filter((s) => s.kind === kindFilter);
  }, [resp, kindFilter]);

  const severityCounts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 } as Record<Severity, number>;
    if (resp) for (const s of resp.signals) c[s.severity] += 1;
    return c;
  }, [resp]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 28, color: "#e8e0d2" }}>
            Said vs did
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {resp ? `${resp.total_signals} drift signal${resp.total_signals === 1 ? "" : "s"} across ${resp.total_said} stated commitments` : "loading…"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ color: "#666", fontSize: 11, letterSpacing: 1, textTransform: "uppercase" }}>window</span>
          {(["7d", "30d", "90d"] as WindowChoice[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindowChoice(w)}
              style={{
                padding: "4px 10px",
                background: windowChoice === w ? "#e8e0d2" : "transparent",
                color: windowChoice === w ? "#111" : "#aaa",
                border: "1px solid " + (windowChoice === w ? "#e8e0d2" : "#333"),
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {w}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ color: "#a14040", fontSize: 12 }}>{severityCounts.high} high</span>
          <span style={{ color: "#a07a40", fontSize: 12 }}>· {severityCounts.medium} med</span>
          <span style={{ color: "#666", fontSize: 12 }}>· {severityCounts.low} low</span>
          <button
            type="button"
            onClick={load}
            style={{ marginLeft: 8, padding: "4px 10px", background: "transparent", color: "#aaa", border: "1px solid #333", fontSize: 12, cursor: "pointer" }}
          >
            Refresh
          </button>
        </div>

        {resp && resp.signals.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <KindPill active={kindFilter === "all"} onClick={() => setKindFilter("all")} label={`All · ${resp.signals.length}`} color="#888" />
            {(Object.keys(resp.by_kind) as SignalKind[]).map((k) => (
              <KindPill
                key={k}
                active={kindFilter === k}
                onClick={() => setKindFilter(k)}
                label={`${KIND_LABEL[k]} · ${resp.by_kind[k]}`}
                color={KIND_COLOR[k]}
              />
            ))}
          </div>
        ) : null}
      </header>

      {loading && !resp ? <div style={{ color: "#888" }}>scanning…</div> : null}
      {error ? <div style={{ color: "#f4a3a3" }}>{error}</div> : null}

      {resp && filtered.length === 0 && !loading ? (
        <div
          style={{
            padding: 24,
            border: "1px solid #2a2a2a",
            color: "#9aa28e",
            fontFamily: "var(--font-serif, Georgia, serif)",
            fontStyle: "italic",
            fontSize: 18,
          }}
        >
          No drift in the {windowChoice} window. What you said matches what you did.
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((s, i) => (
          <SignalCard key={`${s.kind}-${s.said.id}-${i}`} sig={s} />
        ))}
      </div>
    </div>
  );
}

function KindPill({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "3px 9px",
        background: active ? color : "transparent",
        color: active ? "#111" : color,
        border: "1px solid " + color,
        fontSize: 11,
        letterSpacing: 0.5,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function SignalCard({ sig }: { sig: Signal }) {
  return (
    <div
      style={{
        padding: 14,
        background: SEVERITY_BG[sig.severity],
        borderLeft: `3px solid ${SEVERITY_BORDER[sig.severity]}`,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: 1,
            color: SEVERITY_BORDER[sig.severity],
            border: `1px solid ${SEVERITY_BORDER[sig.severity]}`,
            padding: "1px 6px",
          }}
        >
          {SEVERITY_LABEL[sig.severity]}
        </span>
        <span style={{ fontSize: 11, letterSpacing: 0.5, color: KIND_COLOR[sig.kind], textTransform: "uppercase" }}>
          {KIND_LABEL[sig.kind]}
        </span>
        {typeof sig.gap_days === "number" ? (
          <span style={{ fontSize: 11, color: "#888" }}>· {sig.gap_days}d gap</span>
        ) : null}
        <span style={{ flex: 1 }} />
        <a href={sig.said.href} style={{ fontSize: 11, color: "#aaa", textDecoration: "none" }}>
          open →
        </a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#888", marginBottom: 4 }}>SAID · {sig.said.date}</div>
          <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", color: "#e8e0d2", fontSize: 15, lineHeight: 1.4 }}>
            {sig.said.text}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1, color: "#888", marginBottom: 4 }}>DID · {sig.did?.date ?? "—"}</div>
          {sig.did ? (
            <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "#cdb6ff", fontSize: 14, lineHeight: 1.4 }}>
              {sig.did.text}
            </div>
          ) : (
            <div style={{ color: "#666", fontStyle: "italic", fontSize: 14 }}>silence</div>
          )}
        </div>
      </div>

      {sig.note ? <div style={{ fontSize: 12, color: "#9aa28e" }}>{sig.note}</div> : null}
    </div>
  );
}
