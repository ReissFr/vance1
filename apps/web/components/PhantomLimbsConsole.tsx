"use client";

import { useCallback, useEffect, useState } from "react";

type PostMention = { date: string; snippet: string; msg_id: string };

type PhantomLimb = {
  id: string;
  scan_id: string;
  topic: string;
  topic_aliases: string[];
  claim_text: string;
  claim_kind: ClaimKind;
  claim_date: string;
  claim_message_id: string | null;
  claim_conversation_id: string | null;
  days_since_claim: number;
  post_mention_count: number;
  post_mention_days: number;
  post_mentions: PostMention[];
  haunting_score: number;
  status: Status;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Stats = {
  total: number;
  pending: number;
  acknowledged: number;
  contested: number;
  resolved: number;
  dismissed: number;
  haunting_5: number;
  haunting_4: number;
};

type Status = "pending" | "acknowledged" | "contested" | "resolved" | "dismissed";
type FilterStatus = Status | "pinned" | "archived" | "all";

type ClaimKind =
  | "done_with" | "moved_on" | "let_go" | "no_longer_thinking"
  | "finished" | "past_it" | "not_my_problem" | "put_down";

const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  done_with: "DONE WITH",
  moved_on: "MOVED ON FROM",
  let_go: "LET GO OF",
  no_longer_thinking: "NO LONGER THINKING ABOUT",
  finished: "FINISHED WITH",
  past_it: "PAST IT",
  not_my_problem: "NOT MY PROBLEM",
  put_down: "PUT DOWN",
};

// The signal colour: pink (haunting) for high scores, amber for mid, muted for low
function hauntingColour(score: number): string {
  if (score >= 5) return "#f4a8a8";
  if (score >= 4) return "#f4c9d8";
  if (score >= 3) return "#fbb86d";
  return "#9aa28e";
}

const STATUS_COLOR: Record<Status, string> = {
  pending: "#bfb5a8",
  acknowledged: "#7affcb",
  contested: "#fbb86d",
  resolved: "#c9b3f4",
  dismissed: "#9aa28e",
};

function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  if (day < 90) return `${Math.round(day / 7)}w ago`;
  return `${Math.round(day / 30)}mo ago`;
}

function dotMeter(score: number, color: string): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: 7, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

export function PhantomLimbsConsole() {
  const [rows, setRows] = useState<PhantomLimb[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("pending");
  const [minHaunting, setMinHaunting] = useState<number>(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; latency_ms?: number; signals?: Record<string, number> } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(180);

  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<Status>("acknowledged");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", statusFilter);
      params.set("min_haunting", String(minHaunting));
      params.set("limit", "100");
      const r = await fetch(`/api/phantom-limbs?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { phantom_limbs: PhantomLimb[]; stats: Stats };
      setRows(j.phantom_limbs);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, minHaunting]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/phantom-limbs/scan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: composeWindow }),
      });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; latency_ms?: number; signals?: Record<string, number> };
      setScanResult({ inserted: j.inserted, latency_ms: j.latency_ms, signals: j.signals });
      setComposeOpen(false);
      setStatusFilter("pending");
      await load();
      setTimeout(() => setScanResult(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await fetch(`/api/phantom-limbs/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const e = await r.text();
        throw new Error(`HTTP ${r.status}: ${e.slice(0, 200)}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ padding: "20px 24px", color: "#e8e0d2", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontSize: 12, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase" }}>
          {stats ? `${stats.total} phantom limbs · ${stats.pending} pending · ${stats.haunting_5} severely haunting` : ""}
        </div>
        <button
          onClick={() => setComposeOpen(true)}
          style={{ background: "#f4a8a8", color: "#1c1815", border: "none", padding: "8px 14px", fontSize: 13, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
        >
          Scan for phantom limbs
        </button>
      </div>

      {/* Stats panel */}
      {stats && stats.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12, marginBottom: 22, border: "1px solid #2a2620", padding: 14, background: "#171411" }}>
          <Stat label="severely haunting" value={stats.haunting_5} colour="#f4a8a8" big />
          <Stat label="strong haunting" value={stats.haunting_4} colour="#f4c9d8" />
          <Stat label="pending" value={stats.pending} colour="#bfb5a8" />
          <Stat label="acknowledged" value={stats.acknowledged} colour={STATUS_COLOR.acknowledged} />
          <Stat label="resolved" value={stats.resolved} colour={STATUS_COLOR.resolved} />
          <Stat label="contested" value={stats.contested} colour={STATUS_COLOR.contested} />
        </div>
      )}

      {/* Filter pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {(["pending", "acknowledged", "contested", "resolved", "dismissed", "pinned", "archived", "all"] as const).map((s) => {
          const active = statusFilter === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                background: active ? "#3a342c" : "transparent",
                color: active ? "#e8e0d2" : "#8a8378",
                border: `1px solid ${active ? "#5a544c" : "#2a2620"}`,
                padding: "5px 12px",
                fontSize: 11,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          );
        })}
      </div>

      {/* Min haunting filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginRight: 4 }}>Min haunting:</span>
        {[1, 2, 3, 4, 5].map((n) => {
          const active = minHaunting === n;
          const c = hauntingColour(n);
          return (
            <button
              key={n}
              onClick={() => setMinHaunting(n)}
              style={{
                background: active ? c : "transparent",
                color: active ? "#1c1815" : c,
                border: `1px solid ${c}`,
                padding: "3px 8px",
                fontSize: 10,
                letterSpacing: 0.4,
                cursor: "pointer",
                fontWeight: active ? 700 : 500,
              }}
            >
              ≥ {n}
            </button>
          );
        })}
      </div>

      {error && <div style={{ color: "#f4a8a8", fontSize: 13, marginBottom: 12 }}>error: {error}</div>}
      {scanResult && (
        <div style={{ background: "#171411", border: "1px solid #f4a8a8", padding: 12, marginBottom: 14, fontSize: 12, color: "#e8e0d2" }}>
          scan complete · {scanResult.inserted} new phantom limbs · {scanResult.latency_ms ? `${Math.round(scanResult.latency_ms / 1000)}s` : ""}
          {scanResult.signals?.claim_candidates != null && (
            <span style={{ color: "#8a8378", marginLeft: 12 }}>{scanResult.signals.claim_candidates} candidate claims, {scanResult.signals.claims_extracted ?? 0} valid</span>
          )}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#8a8378", fontSize: 13 }}>loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#8a8378", fontSize: 13, padding: "40px 0", textAlign: "center" }}>
          {stats && stats.total === 0 ? "no scan yet — run one to see what you've claimed to put down" : "no phantom limbs match this filter"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((p) => {
            const tint = hauntingColour(p.haunting_score);
            const statusColour = STATUS_COLOR[p.status];
            return (
              <div
                key={p.id}
                style={{
                  border: `1px solid ${p.pinned ? tint : "#2a2620"}`,
                  borderLeft: `3px solid ${tint}`,
                  padding: 16,
                  background: p.archived_at ? "#0f0d0a" : "#171411",
                  opacity: p.archived_at ? 0.6 : 1,
                }}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: tint, letterSpacing: 1.6, textTransform: "uppercase" }}>{CLAIM_KIND_LABEL[p.claim_kind]}</span>
                    {dotMeter(p.haunting_score, tint)}
                    <span style={{ fontSize: 11, color: "#5a544c" }}>haunting {p.haunting_score}/5</span>
                    {p.status !== "pending" && (
                      <span style={{ fontSize: 9, color: statusColour, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${statusColour}`, padding: "1px 5px" }}>
                        {p.status}
                      </span>
                    )}
                    {p.pinned && (
                      <span style={{ fontSize: 9, color: tint, letterSpacing: 1.2, textTransform: "uppercase", border: `1px solid ${tint}`, padding: "1px 5px" }}>pinned</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "#5a544c" }}>{relTime(p.created_at)}</div>
                </div>

                {/* Topic — the headline */}
                <div style={{ fontFamily: "Georgia, serif", fontSize: 22, color: tint, marginBottom: 10, letterSpacing: -0.3 }}>
                  {p.topic}
                </div>

                {/* The verdict line */}
                <div style={{ display: "flex", gap: 18, marginBottom: 14, fontSize: 13 }}>
                  <div>
                    <span style={{ color: "#8a8378" }}>days since claim:</span>{" "}
                    <span style={{ color: "#e8e0d2", fontWeight: 600 }}>{p.days_since_claim}</span>
                  </div>
                  <div>
                    <span style={{ color: "#8a8378" }}>mentions since:</span>{" "}
                    <span style={{ color: tint, fontWeight: 700, fontSize: 16 }}>{p.post_mention_count}</span>{" "}
                    <span style={{ color: "#5a544c", fontSize: 11 }}>across {p.post_mention_days}d</span>
                  </div>
                </div>

                {/* The claim quote */}
                <div style={{ background: "#1c1815", borderLeft: `2px solid ${tint}`, padding: "10px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>What you said on {p.claim_date}</div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 15, fontStyle: "italic", color: "#e8e0d2", lineHeight: 1.5 }}>
                    &ldquo;{p.claim_text}&rdquo;
                  </div>
                </div>

                {/* Post-mention receipts */}
                {p.post_mentions.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>
                      But since then ({p.post_mention_count} times — sample of {Math.min(p.post_mentions.length, p.post_mention_count)}):
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {p.post_mentions.map((m, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#bfb5a8", padding: "6px 10px", background: "#0f0d0a", borderLeft: "1px solid #2a2620", lineHeight: 1.45 }}>
                          <span style={{ color: "#5a544c", fontFamily: "ui-monospace, monospace", marginRight: 8 }}>{m.date}</span>
                          <span style={{ fontStyle: "italic" }}>{m.snippet}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Topic aliases — what was searched */}
                {p.topic_aliases.length > 0 && (
                  <div style={{ fontSize: 10, color: "#5a544c", marginBottom: 12 }}>
                    matched: <span style={{ fontFamily: "ui-monospace, monospace", color: "#8a8378" }}>{[p.topic, ...p.topic_aliases].join(" / ")}</span>
                  </div>
                )}

                {/* Status note quote */}
                {p.status_note && (
                  <div style={{ fontSize: 12, color: "#8a8378", borderTop: "1px solid #2a2620", paddingTop: 8, fontStyle: "italic", marginBottom: 8 }}>
                    your response: {p.status_note}
                  </div>
                )}

                {/* Resolve panel */}
                {resolveOpenId === p.id ? (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2620" }}>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                      {(["acknowledged", "contested", "resolved", "dismissed"] as const).map((s) => {
                        const active = resolveStatus === s;
                        const c = STATUS_COLOR[s];
                        return (
                          <button
                            key={s}
                            onClick={() => setResolveStatus(s)}
                            style={{
                              background: active ? c : "transparent",
                              color: active ? "#1c1815" : c,
                              border: `1px solid ${c}`,
                              padding: "4px 11px",
                              fontSize: 10,
                              letterSpacing: 1.2,
                              textTransform: "uppercase",
                              cursor: "pointer",
                              fontWeight: active ? 700 : 500,
                            }}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="optional note — what's actually going on..."
                      rows={2}
                      style={{ width: "100%", background: "#0f0d0a", color: "#e8e0d2", border: `1px solid ${STATUS_COLOR[resolveStatus]}`, padding: 8, fontSize: 13, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }}
                    />
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button
                        onClick={async () => {
                          const body: Record<string, unknown> = { status: resolveStatus };
                          if (resolveNote.trim().length > 0) body.status_note = resolveNote;
                          await patch(p.id, body);
                          setResolveOpenId(null);
                          setResolveNote("");
                        }}
                        style={{ background: STATUS_COLOR[resolveStatus], color: "#1c1815", border: "none", padding: "5px 12px", fontSize: 11, fontWeight: 600, letterSpacing: 0.4, cursor: "pointer" }}
                      >
                        save as {resolveStatus}
                      </button>
                      <button
                        onClick={() => { setResolveOpenId(null); setResolveNote(""); }}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "5px 12px", fontSize: 11, cursor: "pointer" }}
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6, marginTop: 12, paddingTop: 10, borderTop: "1px solid #2a2620", flexWrap: "wrap" }}>
                    {p.status === "pending" && (
                      <>
                        {(["acknowledged", "contested", "resolved", "dismissed"] as const).map((s) => (
                          <button
                            key={s}
                            onClick={() => { setResolveOpenId(p.id); setResolveStatus(s); setResolveNote(p.status_note ?? ""); }}
                            style={{ background: "transparent", color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                          >
                            {s}
                          </button>
                        ))}
                      </>
                    )}
                    <button
                      onClick={() => patch(p.id, { pin: !p.pinned })}
                      style={{ background: "transparent", color: p.pinned ? tint : "#8a8378", border: `1px solid ${p.pinned ? tint : "#2a2620"}`, padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                    >
                      {p.pinned ? "unpin" : "pin"}
                    </button>
                    {p.archived_at ? (
                      <button
                        onClick={() => patch(p.id, { restore: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        restore
                      </button>
                    ) : (
                      <button
                        onClick={() => patch(p.id, { archive: true })}
                        style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "4px 10px", fontSize: 10, letterSpacing: 1, textTransform: "uppercase", cursor: "pointer" }}
                      >
                        archive
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Compose modal */}
      {composeOpen && (
        <div
          onClick={() => setComposeOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#171411", border: "1px solid #f4a8a8", padding: 24, width: "min(440px, 92vw)" }}
          >
            <div style={{ fontSize: 13, color: "#f4a8a8", letterSpacing: 1.6, textTransform: "uppercase", marginBottom: 12 }}>
              Scan for phantom limbs
            </div>
            <div style={{ fontSize: 12, color: "#8a8378", lineHeight: 1.55, marginBottom: 16 }}>
              Mines your messages in the last <strong style={{ color: "#e8e0d2" }}>{composeWindow} days</strong> for things you have claimed to have moved on from, then counts how many times you have mentioned the same topic since the claim. Surfaces the gap between what your words have put down and what your body still carries.
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: "#8a8378", letterSpacing: 1.4, textTransform: "uppercase", marginBottom: 6 }}>Window</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[30, 60, 90, 120, 180, 270, 365].map((days) => (
                  <button
                    key={days}
                    onClick={() => setComposeWindow(days)}
                    style={{
                      background: composeWindow === days ? "#f4a8a8" : "transparent",
                      color: composeWindow === days ? "#1c1815" : "#bfb5a8",
                      border: `1px solid ${composeWindow === days ? "#f4a8a8" : "#2a2620"}`,
                      padding: "5px 11px",
                      fontSize: 11,
                      letterSpacing: 0.6,
                      cursor: "pointer",
                      fontWeight: composeWindow === days ? 700 : 500,
                    }}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button
                onClick={runScan}
                disabled={scanning}
                style={{
                  background: scanning ? "#3a342c" : "#f4a8a8",
                  color: scanning ? "#8a8378" : "#1c1815",
                  border: "none",
                  padding: "9px 16px",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.4,
                  cursor: scanning ? "not-allowed" : "pointer",
                }}
              >
                {scanning ? "scanning..." : "Run scan"}
              </button>
              <button
                onClick={() => setComposeOpen(false)}
                style={{ background: "transparent", color: "#8a8378", border: "1px solid #2a2620", padding: "9px 16px", fontSize: 12, cursor: "pointer" }}
              >
                cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, colour, big = false }: { label: string; value: number; colour: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#5a544c", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 20, color: colour, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
