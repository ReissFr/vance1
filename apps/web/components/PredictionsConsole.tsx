"use client";

import { useCallback, useEffect, useState } from "react";

type Prediction = {
  id: string;
  claim: string;
  confidence: number;
  resolve_by: string;
  status: "open" | "resolved_yes" | "resolved_no" | "withdrawn";
  resolved_at: string | null;
  resolved_note: string | null;
  category: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type CalibrationPoint = {
  label: string;
  midpoint: number;
  n: number;
  hit_rate: number | null;
};

type CalibrationResp = {
  total: number;
  yes: number;
  no: number;
  brier: number | null;
  points: CalibrationPoint[];
};

type Filter = "open" | "resolved" | "all";

const STATUS_COLOR: Record<Prediction["status"], string> = {
  open: "#bfd4ee",
  resolved_yes: "#7affcb",
  resolved_no: "#f4a3a3",
  withdrawn: "#cccccc",
};

const STATUS_LABEL: Record<Prediction["status"], string> = {
  open: "Open",
  resolved_yes: "Hit",
  resolved_no: "Miss",
  withdrawn: "Withdrawn",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dueLabel(resolveBy: string, status: Prediction["status"]): { text: string; tone: "due" | "soon" | "later" | "done" } {
  if (status !== "open") return { text: "", tone: "done" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(resolveBy + "T00:00:00");
  const days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, tone: "due" };
  if (days === 0) return { text: "resolves today", tone: "due" };
  if (days <= 7) return { text: `in ${days}d`, tone: "soon" };
  return { text: `in ${days}d`, tone: "later" };
}

export function PredictionsConsole() {
  const [rows, setRows] = useState<Prediction[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [calibration, setCalibration] = useState<CalibrationResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [claim, setClaim] = useState("");
  const [confidence, setConfidence] = useState(70);
  const [resolveBy, setResolveBy] = useState(plusDays(30));
  const [category, setCategory] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);

  const [resolving, setResolving] = useState<Prediction | null>(null);
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async (f: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/predictions?status=${f}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`load failed (${r.status})`);
      const j = (await r.json()) as { rows: Prediction[] };
      setRows(j.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCalibration = useCallback(async () => {
    try {
      const r = await fetch("/api/predictions/calibration", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as CalibrationResp;
      setCalibration(j);
    } catch {
      // calibration is optional
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  useEffect(() => {
    void loadCalibration();
  }, [loadCalibration]);

  async function submit() {
    if (!claim.trim()) return;
    setSaving(true);
    try {
      const tags = tagsText
        .split(/[,\n]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 12);
      const r = await fetch("/api/predictions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claim: claim.trim(),
          confidence,
          resolve_by: resolveBy,
          category: category.trim() || undefined,
          tags,
        }),
      });
      if (!r.ok) throw new Error(`save failed (${r.status})`);
      setClaim("");
      setConfidence(70);
      setResolveBy(plusDays(30));
      setCategory("");
      setTagsText("");
      setShowForm(false);
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  async function submitResolve(verdict: "yes" | "no" | "withdraw") {
    if (!resolving) return;
    await fetch(`/api/predictions/${resolving.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resolve: verdict, note: resolveNote.trim() || undefined }),
    });
    setResolving(null);
    setResolveNote("");
    await load(filter);
    await loadCalibration();
  }

  async function reopen(p: Prediction) {
    await fetch(`/api/predictions/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reopen: true }),
    });
    void load(filter);
    void loadCalibration();
  }

  async function remove(p: Prediction) {
    if (!confirm("Delete this prediction?")) return;
    await fetch(`/api/predictions/${p.id}`, { method: "DELETE" });
    void load(filter);
    void loadCalibration();
  }

  return (
    <div style={{ padding: "8px 0 64px", maxWidth: 920 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 22 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {(["open", "resolved", "all"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "1.4px",
                textTransform: "uppercase",
                padding: "5px 11px",
                borderRadius: 5,
                border: "1px solid var(--rule)",
                background: filter === f ? "var(--surface-2)" : "transparent",
                color: filter === f ? "var(--ink)" : "var(--ink-3)",
                cursor: "pointer",
              }}
            >
              {f}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <button
          onClick={() => setShowForm((v) => !v)}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            padding: "6px 14px",
            borderRadius: 5,
            border: "1px solid var(--indigo)",
            background: showForm ? "var(--indigo)" : "transparent",
            color: showForm ? "var(--bg)" : "var(--indigo)",
            cursor: "pointer",
          }}
        >
          {showForm ? "Close" : "+ Prediction"}
        </button>
      </div>

      {calibration && calibration.total > 0 && <CalibrationPanel data={calibration} />}

      {showForm && (
        <div
          style={{
            border: "1px solid var(--rule)",
            borderRadius: 12,
            padding: 18,
            marginBottom: 26,
            background: "var(--surface)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <textarea
            placeholder="The claim — a falsifiable statement (e.g. 'The Lisbon flat will close before 2026-06-01')"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={2}
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 16,
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              color: "var(--ink)",
              resize: "vertical",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "1.2px", textTransform: "uppercase" }}>
              Confidence
            </span>
            <input
              type="range"
              min={1}
              max={99}
              step={1}
              value={confidence}
              onChange={(e) => setConfidence(parseInt(e.target.value, 10))}
              style={{ flex: 1, minWidth: 200, accentColor: "var(--indigo)" }}
            />
            <div
              style={{
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 24,
                color: "var(--ink)",
                minWidth: 56,
                textAlign: "right",
              }}
            >
              {confidence}%
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-3)", letterSpacing: "1.2px", textTransform: "uppercase" }}>
              Resolve by
            </span>
            <input
              type="date"
              value={resolveBy}
              min={todayIso()}
              onChange={(e) => setResolveBy(e.target.value)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                padding: "5px 8px",
                borderRadius: 5,
                border: "1px solid var(--rule)",
                background: "var(--bg)",
                color: "var(--ink)",
              }}
            />
            <div style={{ display: "flex", gap: 4 }}>
              {[7, 30, 90, 180, 365].map((d) => (
                <button
                  key={d}
                  onClick={() => setResolveBy(plusDays(d))}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid var(--rule)",
                    background: "transparent",
                    color: "var(--ink-3)",
                    cursor: "pointer",
                  }}
                >
                  +{d}d
                </button>
              ))}
            </div>
          </div>

          <input
            placeholder="Category (optional — e.g. business, health, market)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              color: "var(--ink)",
            }}
          />

          <input
            placeholder="Tags (comma-separated)"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              padding: "7px 10px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: "var(--bg)",
              color: "var(--ink-2)",
            }}
          />

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowForm(false)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "1.2px",
                textTransform: "uppercase",
                padding: "7px 14px",
                borderRadius: 5,
                border: "1px solid var(--rule)",
                background: "transparent",
                color: "var(--ink-2)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={saving || !claim.trim()}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                letterSpacing: "1.2px",
                textTransform: "uppercase",
                padding: "7px 14px",
                borderRadius: 5,
                border: "1px solid var(--indigo)",
                background: "var(--indigo)",
                color: "var(--bg)",
                cursor: saving ? "wait" : "pointer",
                opacity: !claim.trim() ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : "Lock it in"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "#ff6b6b", marginBottom: 14 }}>
          {error}
        </div>
      )}

      {loading && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "1.2px" }}>
          LOADING…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            color: "var(--ink-3)",
            fontSize: 16,
            padding: "30px 0",
          }}
        >
          No predictions yet. Lock in a falsifiable forecast with a confidence and a resolve-by date — over time the calibration curve shows whether your "80% sure" actually means 80%.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((p) => {
            const due = dueLabel(p.resolve_by, p.status);
            const dueColor = due.tone === "due" ? "#ff6b6b" : due.tone === "soon" ? "#f4c9d8" : "var(--ink-3)";
            return (
              <div
                key={p.id}
                style={{
                  border: "1px solid var(--rule)",
                  borderLeft: `3px solid ${STATUS_COLOR[p.status]}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  background: "var(--surface)",
                  opacity: p.status === "withdrawn" ? 0.55 : 1,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
                  <div
                    style={{
                      fontFamily: "var(--serif)",
                      fontStyle: "italic",
                      fontSize: 16,
                      color: "var(--ink)",
                      flex: 1,
                      lineHeight: 1.45,
                    }}
                  >
                    {p.claim}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 13,
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: `1px solid ${STATUS_COLOR[p.status]}`,
                      color: "var(--ink)",
                      letterSpacing: "0.4px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.confidence}%
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                    letterSpacing: "0.5px",
                    flexWrap: "wrap",
                    marginBottom: p.resolved_note ? 8 : 0,
                  }}
                >
                  {p.status === "open" ? (
                    <>
                      <span>resolves {p.resolve_by}</span>
                      {due.text && (
                        <span style={{ color: dueColor }}>· {due.text}</span>
                      )}
                    </>
                  ) : (
                    <>
                      <span
                        style={{
                          padding: "1px 6px",
                          borderRadius: 3,
                          background: STATUS_COLOR[p.status],
                          color: "var(--bg)",
                          letterSpacing: "1px",
                          textTransform: "uppercase",
                          fontSize: 9.5,
                        }}
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                      <span>· resolved {p.resolved_at?.slice(0, 10)}</span>
                    </>
                  )}
                  {p.category && <span>· {p.category}</span>}
                  {p.tags.length > 0 && (
                    <span>· {p.tags.map((t) => `#${t}`).join(" ")}</span>
                  )}
                  <div style={{ flex: 1 }} />
                  {p.status === "open" ? (
                    <button
                      onClick={() => {
                        setResolving(p);
                        setResolveNote("");
                      }}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        letterSpacing: "1.2px",
                        textTransform: "uppercase",
                        padding: "3px 10px",
                        borderRadius: 4,
                        border: "1px solid var(--indigo)",
                        background: "var(--indigo)",
                        color: "var(--bg)",
                        cursor: "pointer",
                      }}
                    >
                      Resolve
                    </button>
                  ) : (
                    <button
                      onClick={() => reopen(p)}
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        letterSpacing: "1.2px",
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: 4,
                        border: "1px solid var(--rule)",
                        background: "transparent",
                        color: "var(--ink-2)",
                        cursor: "pointer",
                      }}
                    >
                      Reopen
                    </button>
                  )}
                  <button
                    onClick={() => remove(p)}
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 11,
                      padding: "3px 8px",
                      borderRadius: 4,
                      border: "1px solid var(--rule)",
                      background: "transparent",
                      color: "var(--ink-3)",
                      cursor: "pointer",
                    }}
                    aria-label="delete"
                  >
                    ×
                  </button>
                </div>

                {p.resolved_note && (
                  <div
                    style={{
                      fontFamily: "var(--serif)",
                      fontStyle: "italic",
                      fontSize: 13,
                      color: "var(--ink-2)",
                      paddingLeft: 10,
                      borderLeft: `2px solid ${STATUS_COLOR[p.status]}`,
                      lineHeight: 1.5,
                      marginTop: 6,
                    }}
                  >
                    {p.resolved_note}
                  </div>
                )}

                {resolving?.id === p.id && (
                  <div
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: "1px solid var(--rule-soft)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <textarea
                      placeholder="What actually happened? (optional)"
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      rows={2}
                      style={{
                        fontFamily: "var(--sans)",
                        fontSize: 13,
                        padding: "7px 9px",
                        borderRadius: 6,
                        border: "1px solid var(--rule)",
                        background: "var(--bg)",
                        color: "var(--ink)",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button
                        onClick={() => {
                          setResolving(null);
                          setResolveNote("");
                        }}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          letterSpacing: "1.2px",
                          textTransform: "uppercase",
                          padding: "5px 12px",
                          borderRadius: 5,
                          border: "1px solid var(--rule)",
                          background: "transparent",
                          color: "var(--ink-2)",
                          cursor: "pointer",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => submitResolve("withdraw")}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          letterSpacing: "1.2px",
                          textTransform: "uppercase",
                          padding: "5px 12px",
                          borderRadius: 5,
                          border: "1px solid var(--rule)",
                          background: "transparent",
                          color: "var(--ink-3)",
                          cursor: "pointer",
                        }}
                      >
                        Withdraw
                      </button>
                      <button
                        onClick={() => submitResolve("no")}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          letterSpacing: "1.2px",
                          textTransform: "uppercase",
                          padding: "5px 14px",
                          borderRadius: 5,
                          border: "1px solid #f4a3a3",
                          background: "#f4a3a3",
                          color: "var(--bg)",
                          cursor: "pointer",
                        }}
                      >
                        Miss
                      </button>
                      <button
                        onClick={() => submitResolve("yes")}
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          letterSpacing: "1.2px",
                          textTransform: "uppercase",
                          padding: "5px 14px",
                          borderRadius: 5,
                          border: "1px solid #7affcb",
                          background: "#7affcb",
                          color: "var(--bg)",
                          cursor: "pointer",
                        }}
                      >
                        Hit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CalibrationPanel({ data }: { data: CalibrationResp }) {
  const W = 280;
  const H = 180;
  const PAD = 24;
  const xScale = (mid: number) => PAD + ((mid - 0) / 100) * (W - 2 * PAD);
  const yScale = (rate: number) => H - PAD - rate * (H - 2 * PAD);

  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 12,
        padding: 18,
        marginBottom: 22,
        background: "var(--surface)",
        display: "flex",
        gap: 24,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <svg width={W} height={H} style={{ overflow: "visible" }}>
        <line
          x1={xScale(0)}
          y1={yScale(0)}
          x2={xScale(100)}
          y2={yScale(1)}
          stroke="var(--rule)"
          strokeWidth={1}
          strokeDasharray="3,3"
        />
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--rule)" strokeWidth={1} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--rule)" strokeWidth={1} />
        {data.points.map((pt) =>
          pt.hit_rate === null ? null : (
            <g key={pt.label}>
              <circle
                cx={xScale(pt.midpoint)}
                cy={yScale(pt.hit_rate)}
                r={Math.max(3, Math.min(10, 2 + pt.n))}
                fill="var(--indigo)"
                opacity={0.7}
              />
            </g>
          ),
        )}
        <text
          x={xScale(0)}
          y={H - PAD + 14}
          fontSize={9}
          fill="var(--ink-3)"
          fontFamily="var(--mono)"
        >
          0%
        </text>
        <text
          x={xScale(100) - 18}
          y={H - PAD + 14}
          fontSize={9}
          fill="var(--ink-3)"
          fontFamily="var(--mono)"
        >
          100%
        </text>
        <text
          x={PAD - 4}
          y={yScale(0)}
          fontSize={9}
          fill="var(--ink-3)"
          fontFamily="var(--mono)"
          textAnchor="end"
        >
          0
        </text>
        <text
          x={PAD - 4}
          y={yScale(1) + 4}
          fontSize={9}
          fill="var(--ink-3)"
          fontFamily="var(--mono)"
          textAnchor="end"
        >
          1
        </text>
      </svg>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--ink)" }}>
          Calibration
        </div>
        <Stat label="Resolved" value={String(data.total)} />
        <Stat label="Hits" value={`${data.yes} / ${data.no} miss`} />
        {data.brier !== null && (
          <Stat
            label="Brier score"
            value={data.brier.toFixed(3)}
            hint="lower is better · 0.25 = chance"
          />
        )}
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 11.5,
            color: "var(--ink-3)",
            fontStyle: "italic",
            maxWidth: 220,
            lineHeight: 1.5,
            marginTop: 4,
          }}
        >
          Dots above the line: overconfident. Below: underconfident. Dot size ∝ count in bucket.
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 9.5,
          color: "var(--ink-3)",
          letterSpacing: "1.2px",
          textTransform: "uppercase",
          minWidth: 90,
        }}
      >
        {label}
      </span>
      <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink)" }}>{value}</span>
      {hint && (
        <span
          style={{
            fontFamily: "var(--sans)",
            fontSize: 10.5,
            fontStyle: "italic",
            color: "var(--ink-3)",
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
