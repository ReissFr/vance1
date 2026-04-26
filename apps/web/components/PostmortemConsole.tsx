"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Decision = {
  id: string;
  title: string;
  choice: string | null;
  expected_outcome: string | null;
  tags: string[] | null;
  created_at: string;
};

type Postmortem = {
  id: string;
  decision_id: string;
  due_at: string;
  scheduled_offset: string | null;
  fired_at: string | null;
  fired_via: string | null;
  responded_at: string | null;
  actual_outcome: string | null;
  outcome_match: number | null;
  surprise_note: string | null;
  lesson: string | null;
  verdict: "right_call" | "wrong_call" | "mixed" | "too_early" | "unclear" | null;
  cancelled_at: string | null;
  created_at: string;
  decisions: Decision | null;
};

type Calibration = {
  responded: number;
  avg_outcome_match: number | null;
  right_call: number;
  wrong_call: number;
  mixed: number;
  too_early: number;
  unclear: number;
};

type Status = "due" | "fired" | "responded" | "cancelled" | "all";

const VERDICT_COLOR: Record<NonNullable<Postmortem["verdict"]>, string> = {
  right_call: "#7affcb",
  wrong_call: "#ff6b6b",
  mixed: "#f4c9d8",
  too_early: "#bfd4ee",
  unclear: "#9aa28e",
};

const VERDICT_LABEL: Record<NonNullable<Postmortem["verdict"]>, string> = {
  right_call: "Right call",
  wrong_call: "Wrong call",
  mixed: "Mixed",
  too_early: "Too early",
  unclear: "Unclear",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function dueLabel(due: string): { text: string; tone: "overdue" | "today" | "soon" | "later" } {
  const ms = new Date(due).getTime() - Date.now();
  const days = Math.round(ms / 86400000);
  if (days < 0) return { text: `${-days}d overdue`, tone: "overdue" };
  if (days === 0) return { text: "due today", tone: "today" };
  if (days <= 7) return { text: `in ${days}d`, tone: "soon" };
  if (days < 30) return { text: `in ${days}d`, tone: "later" };
  if (days < 365) return { text: `in ${Math.round(days / 30)}mo`, tone: "later" };
  return { text: `in ${(days / 365).toFixed(1)}y`, tone: "later" };
}

const TONE_COLOR: Record<"overdue" | "today" | "soon" | "later", string> = {
  overdue: "#ff6b6b",
  today: "#fbb86d",
  soon: "#fbb86d",
  later: "#9aa28e",
};

export function PostmortemConsole() {
  const [status, setStatus] = useState<Status>("due");
  const [rows, setRows] = useState<Postmortem[]>([]);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scheduling, setScheduling] = useState<Decision | null>(null);
  const [decisionsList, setDecisionsList] = useState<Decision[]>([]);
  const [decPickerOpen, setDecPickerOpen] = useState(false);
  const [decPickerLoading, setDecPickerLoading] = useState(false);
  const [pickedOffsets, setPickedOffsets] = useState<string[]>(["1w", "1mo", "3mo", "6mo"]);

  const [responding, setResponding] = useState<Postmortem | null>(null);
  const [actualOutcome, setActualOutcome] = useState("");
  const [outcomeMatch, setOutcomeMatch] = useState<number>(3);
  const [verdict, setVerdict] = useState<NonNullable<Postmortem["verdict"]>>("right_call");
  const [surpriseNote, setSurpriseNote] = useState("");
  const [lesson, setLesson] = useState("");
  const [savingResponse, setSavingResponse] = useState(false);

  const load = useCallback(async (s: Status) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/postmortems?status=${s}&limit=200`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { postmortems: Postmortem[]; calibration: Calibration | null };
      setRows(j.postmortems ?? []);
      setCalibration(j.calibration ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(status); }, [status, load]);

  const openScheduler = useCallback(async () => {
    setDecPickerOpen(true);
    setDecPickerLoading(true);
    try {
      const r = await fetch("/api/decisions?filter=open&limit=50", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { rows: Decision[] };
      setDecisionsList(j.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDecPickerLoading(false);
    }
  }, []);

  const submitSchedule = useCallback(async () => {
    if (!scheduling || pickedOffsets.length === 0) return;
    try {
      const r = await fetch(`/api/decisions/${scheduling.id}/postmortems`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offsets: pickedOffsets, replace_pending: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setScheduling(null);
      setDecPickerOpen(false);
      setPickedOffsets(["1w", "1mo", "3mo", "6mo"]);
      await load(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [scheduling, pickedOffsets, status, load]);

  const startRespond = useCallback((pm: Postmortem) => {
    setResponding(pm);
    setActualOutcome(pm.actual_outcome ?? "");
    setOutcomeMatch(pm.outcome_match ?? 3);
    setVerdict(pm.verdict ?? "right_call");
    setSurpriseNote(pm.surprise_note ?? "");
    setLesson(pm.lesson ?? "");
  }, []);

  const submitResponse = useCallback(async () => {
    if (!responding || actualOutcome.trim().length < 4) return;
    setSavingResponse(true);
    try {
      const r = await fetch(`/api/postmortems/${responding.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actual_outcome: actualOutcome.trim(),
          outcome_match: outcomeMatch,
          verdict,
          surprise_note: surpriseNote.trim() || undefined,
          lesson: lesson.trim() || undefined,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setResponding(null);
      await load(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingResponse(false);
    }
  }, [responding, actualOutcome, outcomeMatch, verdict, surpriseNote, lesson, status, load]);

  const snooze = useCallback(async (pm: Postmortem, days: number) => {
    try {
      await fetch(`/api/postmortems/${pm.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snooze_days: days }),
      });
      await load(status);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [status, load]);

  const cancel = useCallback(async (pm: Postmortem) => {
    try {
      await fetch(`/api/postmortems/${pm.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cancel: true }),
      });
      await load(status);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [status, load]);

  const restore = useCallback(async (pm: Postmortem) => {
    try {
      await fetch(`/api/postmortems/${pm.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      await load(status);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [status, load]);

  const remove = useCallback(async (pm: Postmortem) => {
    if (!confirm("Delete this check-in?")) return;
    try {
      await fetch(`/api/postmortems/${pm.id}`, { method: "DELETE" });
      await load(status);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [status, load]);

  const grouped = useMemo(() => {
    const map = new Map<string, { decision: Decision | null; rows: Postmortem[] }>();
    for (const r of rows) {
      const key = r.decision_id;
      const existing = map.get(key);
      if (existing) existing.rows.push(r);
      else map.set(key, { decision: r.decisions, rows: [r] });
    }
    return Array.from(map.values());
  }, [rows]);

  const avgPct = calibration?.avg_outcome_match ? Math.round((calibration.avg_outcome_match / 5) * 100) : null;

  return (
    <div style={{ padding: "0 24px 80px", color: "#e8e0d2" }}>
      {/* Top control panel */}
      <div style={{
        marginTop: 16,
        padding: 18,
        border: "1px solid rgba(232,224,210,0.18)",
        background: "rgba(232,224,210,0.025)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 18,
      }}>
        <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(232,224,210,0.5)" }}>SCHEDULE A POSTMORTEM</span>
          <span style={{ fontSize: 13, color: "rgba(232,224,210,0.7)" }}>Pick a decision and the cadence at which I'll check whether it's playing out.</span>
        </div>
        <button
          onClick={openScheduler}
          style={{
            padding: "10px 20px",
            background: "#fbb86d",
            color: "#181715",
            border: "none",
            fontSize: 12,
            letterSpacing: "0.1em",
            fontWeight: 600,
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >Schedule check-ins</button>
      </div>

      {/* Calibration banner */}
      {calibration && calibration.responded > 0 && (
        <div style={{
          marginTop: 14,
          padding: 14,
          border: "1px solid rgba(122,255,203,0.25)",
          background: "rgba(122,255,203,0.04)",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 24,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(232,224,210,0.5)" }}>CALIBRATION</span>
            <span style={{ fontSize: 14, color: "#7affcb" }}>{calibration.responded} responded · {avgPct != null ? `${avgPct}% prediction match` : "no match data"}</span>
          </div>
          <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
            <span style={{ padding: "2px 8px", border: "1px solid rgba(122,255,203,0.4)", color: "#7affcb" }}>{calibration.right_call} right</span>
            <span style={{ padding: "2px 8px", border: "1px solid rgba(255,107,107,0.4)", color: "#ff6b6b" }}>{calibration.wrong_call} wrong</span>
            <span style={{ padding: "2px 8px", border: "1px solid rgba(244,201,216,0.4)", color: "#f4c9d8" }}>{calibration.mixed} mixed</span>
            <span style={{ padding: "2px 8px", border: "1px solid rgba(191,212,238,0.4)", color: "#bfd4ee" }}>{calibration.too_early} too early</span>
          </div>
        </div>
      )}

      {/* Status filter pills */}
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        {(["due", "fired", "responded", "cancelled", "all"] as const).map((s) => {
          const active = status === s;
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              style={{
                padding: "6px 14px",
                background: active ? "#e8e0d2" : "transparent",
                color: active ? "#181715" : "rgba(232,224,210,0.7)",
                border: "1px solid rgba(232,224,210,0.3)",
                fontSize: 11,
                letterSpacing: "0.1em",
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >{s}</button>
          );
        })}
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: 10, border: "1px solid #ff6b6b", color: "#ff6b6b", fontSize: 12 }}>{error}</div>
      )}

      {/* Body */}
      <div style={{ marginTop: 22 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(232,224,210,0.4)", fontSize: 12 }}>loading…</div>
        ) : grouped.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "rgba(232,224,210,0.4)", fontSize: 13 }}>nothing here yet — schedule a check-in on one of your decisions</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {grouped.map(({ decision, rows: pms }) => (
              <div key={decision?.id ?? Math.random()} style={{ border: "1px solid rgba(232,224,210,0.14)" }}>
                {/* Decision header */}
                <div style={{ padding: 14, borderBottom: "1px solid rgba(232,224,210,0.1)", background: "rgba(232,224,210,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, letterSpacing: "0.18em", color: "#fbb86d" }}>DECISION</span>
                    <span style={{ fontSize: 11, color: "rgba(232,224,210,0.4)" }}>{decision?.created_at ? relTime(decision.created_at) : "—"}</span>
                    <span style={{ fontSize: 11, color: "rgba(232,224,210,0.4)" }}>{pms.length} check-in{pms.length === 1 ? "" : "s"}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 16, color: "#e8e0d2" }}>{decision?.title ?? "(decision deleted)"}</div>
                  {decision?.expected_outcome && (
                    <div style={{ marginTop: 6, fontSize: 13, color: "rgba(232,224,210,0.6)", fontStyle: "italic" }}>Expected: {decision.expected_outcome}</div>
                  )}
                </div>

                {/* Postmortem rows */}
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {pms.map((pm) => {
                    const due = dueLabel(pm.due_at);
                    const isResponded = !!pm.responded_at;
                    const isCancelled = !!pm.cancelled_at;
                    return (
                      <div
                        key={pm.id}
                        style={{
                          padding: 14,
                          borderTop: "1px solid rgba(232,224,210,0.06)",
                          borderLeft: `3px solid ${isResponded && pm.verdict ? VERDICT_COLOR[pm.verdict] : isCancelled ? "rgba(232,224,210,0.2)" : TONE_COLOR[due.tone]}`,
                          background: isCancelled ? "rgba(232,224,210,0.015)" : "transparent",
                          opacity: isCancelled ? 0.5 : 1,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ padding: "2px 8px", border: "1px solid rgba(232,224,210,0.3)", fontSize: 11, color: "rgba(232,224,210,0.7)" }}>
                            {pm.scheduled_offset ?? "custom"}
                          </span>
                          {isResponded ? (
                            <span style={{
                              padding: "2px 8px",
                              border: `1px solid ${pm.verdict ? VERDICT_COLOR[pm.verdict] : "rgba(232,224,210,0.3)"}`,
                              color: pm.verdict ? VERDICT_COLOR[pm.verdict] : "#e8e0d2",
                              fontSize: 11,
                            }}>{pm.verdict ? VERDICT_LABEL[pm.verdict] : "responded"}</span>
                          ) : isCancelled ? (
                            <span style={{ fontSize: 11, color: "rgba(232,224,210,0.4)" }}>cancelled</span>
                          ) : (
                            <span style={{ fontSize: 11, color: TONE_COLOR[due.tone] }}>{due.text}</span>
                          )}
                          {pm.fired_at && !isResponded && !isCancelled && (
                            <span style={{ fontSize: 11, color: "rgba(232,224,210,0.4)" }}>nudged {relTime(pm.fired_at)} {pm.fired_via ? `(${pm.fired_via})` : ""}</span>
                          )}
                          {isResponded && pm.outcome_match != null && (
                            <span style={{ display: "flex", gap: 2 }}>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <span key={n} style={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: "50%",
                                  background: n <= (pm.outcome_match ?? 0) ? "#7affcb" : "rgba(232,224,210,0.15)",
                                }} />
                              ))}
                            </span>
                          )}
                        </div>

                        {isResponded && pm.actual_outcome && (
                          <div style={{ marginTop: 10, fontSize: 14, color: "#e8e0d2", fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.6 }}>
                            "{pm.actual_outcome}"
                          </div>
                        )}
                        {isResponded && pm.surprise_note && (
                          <div style={{ marginTop: 8, padding: 8, borderLeft: "2px solid #fbb86d", background: "rgba(251,184,109,0.04)", fontSize: 12, color: "rgba(232,224,210,0.8)" }}>
                            <span style={{ fontSize: 10, letterSpacing: "0.16em", color: "#fbb86d" }}>SURPRISE</span>
                            <div style={{ marginTop: 4 }}>{pm.surprise_note}</div>
                          </div>
                        )}
                        {isResponded && pm.lesson && (
                          <div style={{ marginTop: 8, padding: 8, borderLeft: "2px solid #7affcb", background: "rgba(122,255,203,0.04)", fontSize: 12, color: "rgba(232,224,210,0.8)" }}>
                            <span style={{ fontSize: 10, letterSpacing: "0.16em", color: "#7affcb" }}>LESSON</span>
                            <div style={{ marginTop: 4 }}>{pm.lesson}</div>
                          </div>
                        )}

                        {/* Action buttons */}
                        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {!isResponded && !isCancelled && (
                            <>
                              <button
                                onClick={() => startRespond(pm)}
                                style={{ padding: "6px 12px", background: "#7affcb", color: "#181715", border: "none", fontSize: 11, letterSpacing: "0.1em", cursor: "pointer", textTransform: "uppercase" }}
                              >Log outcome</button>
                              <button
                                onClick={() => snooze(pm, 7)}
                                style={{ padding: "6px 12px", background: "transparent", color: "#bfd4ee", border: "1px solid rgba(191,212,238,0.4)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                              >Snooze 7d</button>
                              <button
                                onClick={() => snooze(pm, 30)}
                                style={{ padding: "6px 12px", background: "transparent", color: "#bfd4ee", border: "1px solid rgba(191,212,238,0.4)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                              >Snooze 30d</button>
                              <button
                                onClick={() => cancel(pm)}
                                style={{ padding: "6px 12px", background: "transparent", color: "rgba(232,224,210,0.5)", border: "1px solid rgba(232,224,210,0.2)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                              >Cancel</button>
                            </>
                          )}
                          {isResponded && (
                            <button
                              onClick={() => startRespond(pm)}
                              style={{ padding: "6px 12px", background: "transparent", color: "rgba(232,224,210,0.7)", border: "1px solid rgba(232,224,210,0.3)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                            >Edit response</button>
                          )}
                          {isCancelled && (
                            <button
                              onClick={() => restore(pm)}
                              style={{ padding: "6px 12px", background: "transparent", color: "#bfd4ee", border: "1px solid rgba(191,212,238,0.4)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                            >Restore</button>
                          )}
                          <button
                            onClick={() => remove(pm)}
                            style={{ padding: "6px 12px", background: "transparent", color: "rgba(232,224,210,0.4)", border: "1px solid rgba(232,224,210,0.15)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em", marginLeft: "auto" }}
                          >Delete</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Decision picker modal */}
      {decPickerOpen && (
        <div
          onClick={() => { setDecPickerOpen(false); setScheduling(null); }}
          style={{ position: "fixed", inset: 0, background: "rgba(24,23,21,0.85)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 580, maxHeight: "80vh", overflowY: "auto", background: "#181715", border: "1px solid rgba(232,224,210,0.3)", padding: 24 }}
          >
            <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(232,224,210,0.5)" }}>SCHEDULE POSTMORTEM</div>
            {!scheduling ? (
              <>
                <div style={{ marginTop: 8, fontSize: 16, color: "#e8e0d2" }}>Pick a decision</div>
                {decPickerLoading ? (
                  <div style={{ padding: 30, textAlign: "center", color: "rgba(232,224,210,0.4)", fontSize: 12 }}>loading…</div>
                ) : decisionsList.length === 0 ? (
                  <div style={{ padding: 30, textAlign: "center", color: "rgba(232,224,210,0.4)", fontSize: 13 }}>no open decisions — log one first</div>
                ) : (
                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                    {decisionsList.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => setScheduling(d)}
                        style={{ padding: 12, textAlign: "left", background: "rgba(232,224,210,0.04)", border: "1px solid rgba(232,224,210,0.15)", color: "#e8e0d2", cursor: "pointer" }}
                      >
                        <div style={{ fontSize: 14 }}>{d.title}</div>
                        <div style={{ marginTop: 4, fontSize: 11, color: "rgba(232,224,210,0.5)" }}>{relTime(d.created_at)}{d.expected_outcome ? ` · expected: ${d.expected_outcome.slice(0, 80)}` : ""}</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ marginTop: 8, fontSize: 16, color: "#e8e0d2" }}>{scheduling.title}</div>
                <div style={{ marginTop: 16, fontSize: 11, letterSpacing: "0.16em", color: "rgba(232,224,210,0.5)" }}>OFFSETS FROM DECISION DATE</div>
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(["1w", "2w", "1mo", "3mo", "6mo", "1y", "2y"] as const).map((o) => {
                    const on = pickedOffsets.includes(o);
                    return (
                      <button
                        key={o}
                        onClick={() => setPickedOffsets(on ? pickedOffsets.filter((x) => x !== o) : [...pickedOffsets, o])}
                        style={{ padding: "8px 14px", background: on ? "#fbb86d" : "transparent", color: on ? "#181715" : "#e8e0d2", border: "1px solid rgba(251,184,109,0.5)", fontSize: 12, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                      >{o}</button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 18, display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => { setScheduling(null); }}
                    style={{ padding: "8px 16px", background: "transparent", color: "rgba(232,224,210,0.7)", border: "1px solid rgba(232,224,210,0.3)", fontSize: 12, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                  >Back</button>
                  <button
                    onClick={submitSchedule}
                    disabled={pickedOffsets.length === 0}
                    style={{ padding: "8px 16px", background: pickedOffsets.length === 0 ? "rgba(232,224,210,0.1)" : "#fbb86d", color: pickedOffsets.length === 0 ? "rgba(232,224,210,0.3)" : "#181715", border: "none", fontSize: 12, cursor: pickedOffsets.length === 0 ? "not-allowed" : "pointer", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}
                  >Schedule {pickedOffsets.length}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Response modal */}
      {responding && (
        <div
          onClick={() => setResponding(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(24,23,21,0.85)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", background: "#181715", border: "1px solid rgba(232,224,210,0.3)", padding: 24 }}
          >
            <div style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(232,224,210,0.5)" }}>HOW DID IT PLAY OUT?</div>
            <div style={{ marginTop: 8, fontSize: 16, color: "#e8e0d2" }}>{responding.decisions?.title ?? "(decision)"}</div>
            {responding.decisions?.expected_outcome && (
              <div style={{ marginTop: 6, fontSize: 13, color: "rgba(232,224,210,0.6)", fontStyle: "italic" }}>You expected: {responding.decisions.expected_outcome}</div>
            )}

            <label style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.16em", color: "rgba(232,224,210,0.5)", display: "block" }}>WHAT ACTUALLY HAPPENED</label>
            <textarea
              value={actualOutcome}
              onChange={(e) => setActualOutcome(e.target.value)}
              placeholder="A few sentences on what unfolded…"
              style={{ marginTop: 6, width: "100%", minHeight: 100, padding: 10, background: "rgba(232,224,210,0.04)", border: "1px solid rgba(232,224,210,0.2)", color: "#e8e0d2", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
            />

            <label style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.16em", color: "rgba(232,224,210,0.5)", display: "block" }}>HOW CLOSELY DID IT MATCH WHAT YOU EXPECTED? (1-5)</label>
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onClick={() => setOutcomeMatch(n)}
                  style={{ flex: 1, padding: "10px 0", background: outcomeMatch === n ? "#7affcb" : "transparent", color: outcomeMatch === n ? "#181715" : "#e8e0d2", border: "1px solid rgba(122,255,203,0.4)", fontSize: 13, cursor: "pointer", fontWeight: 600 }}
                >{n}</button>
              ))}
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: "rgba(232,224,210,0.4)", display: "flex", justifyContent: "space-between" }}>
              <span>1 = nothing like expected</span><span>5 = exactly as expected</span>
            </div>

            <label style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.16em", color: "rgba(232,224,210,0.5)", display: "block" }}>VERDICT</label>
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(["right_call", "wrong_call", "mixed", "too_early", "unclear"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVerdict(v)}
                  style={{ padding: "8px 14px", background: verdict === v ? VERDICT_COLOR[v] : "transparent", color: verdict === v ? "#181715" : VERDICT_COLOR[v], border: `1px solid ${VERDICT_COLOR[v]}`, fontSize: 12, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                >{VERDICT_LABEL[v]}</button>
              ))}
            </div>

            <label style={{ marginTop: 18, fontSize: 11, letterSpacing: "0.16em", color: "rgba(232,224,210,0.5)", display: "block" }}>SURPRISE (OPTIONAL)</label>
            <input
              value={surpriseNote}
              onChange={(e) => setSurpriseNote(e.target.value)}
              placeholder="What you didn't see coming…"
              style={{ marginTop: 6, width: "100%", padding: 10, background: "rgba(232,224,210,0.04)", border: "1px solid rgba(232,224,210,0.2)", color: "#e8e0d2", fontSize: 13, fontFamily: "inherit" }}
            />

            <label style={{ marginTop: 14, fontSize: 11, letterSpacing: "0.16em", color: "rgba(232,224,210,0.5)", display: "block" }}>LESSON (OPTIONAL)</label>
            <input
              value={lesson}
              onChange={(e) => setLesson(e.target.value)}
              placeholder="One thing to carry forward…"
              style={{ marginTop: 6, width: "100%", padding: 10, background: "rgba(232,224,210,0.04)", border: "1px solid rgba(232,224,210,0.2)", color: "#e8e0d2", fontSize: 13, fontFamily: "inherit" }}
            />

            <div style={{ marginTop: 22, display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setResponding(null)}
                style={{ padding: "8px 16px", background: "transparent", color: "rgba(232,224,210,0.7)", border: "1px solid rgba(232,224,210,0.3)", fontSize: 12, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
              >Cancel</button>
              <button
                onClick={submitResponse}
                disabled={savingResponse || actualOutcome.trim().length < 4}
                style={{ padding: "8px 16px", background: savingResponse || actualOutcome.trim().length < 4 ? "rgba(232,224,210,0.1)" : "#7affcb", color: savingResponse || actualOutcome.trim().length < 4 ? "rgba(232,224,210,0.3)" : "#181715", border: "none", fontSize: 12, cursor: savingResponse || actualOutcome.trim().length < 4 ? "not-allowed" : "pointer", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}
              >{savingResponse ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
