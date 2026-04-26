"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Forecast = {
  id: string;
  forecast_date: string;
  forecast_at: string;
  energy_pred: number;
  mood_pred: number;
  focus_pred: number;
  confidence: number;
  narrative: string;
  recommendations: string[];
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  actual_energy: number | null;
  actual_mood: number | null;
  actual_focus: number | null;
  accuracy_score: number | null;
  scored_at: string | null;
  user_note: string | null;
  pinned: boolean;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Calibration = { scored: number; avg_accuracy: number };
type Status = "all" | "upcoming" | "scored" | "unscored";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayDate(): string { return new Date().toISOString().slice(0, 10); }
function tomorrowDate(): string { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
function dowName(iso: string): string { return DOW[new Date(iso + "T00:00:00Z").getUTCDay()] ?? "?"; }

function relDay(iso: string): string {
  const today = todayDate();
  const ms = new Date(iso + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 1) return `in ${days}d`;
  return `${-days}d ago`;
}

function dotMeter(score: number, total = 5, color = "#7affcb"): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: 7, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

export function EnergyForecastConsole() {
  const [rows, setRows] = useState<Forecast[]>([]);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [status, setStatus] = useState<Status>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [targetDate, setTargetDate] = useState<string>(tomorrowDate());

  const [scoringId, setScoringId] = useState<string | null>(null);
  const [actualEnergy, setActualEnergy] = useState(3);
  const [actualMood, setActualMood] = useState(3);
  const [actualFocus, setActualFocus] = useState(3);
  const [savingScore, setSavingScore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/energy-forecasts?status=${status}&limit=60`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { forecasts: Forecast[]; calibration: Calibration | null };
      setRows(j.forecasts ?? []);
      setCalibration(j.calibration);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/energy-forecasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forecast_date: targetDate }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [targetDate, load]);

  const openScoring = useCallback((f: Forecast) => {
    setScoringId(f.id);
    setActualEnergy(f.actual_energy ?? f.energy_pred);
    setActualMood(f.actual_mood ?? f.mood_pred);
    setActualFocus(f.actual_focus ?? f.focus_pred);
  }, []);

  const saveScore = useCallback(async () => {
    if (!scoringId) return;
    setSavingScore(true);
    setError(null);
    try {
      const r = await fetch(`/api/energy-forecasts/${scoringId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual_energy: actualEnergy, actual_mood: actualMood, actual_focus: actualFocus }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setScoringId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingScore(false);
    }
  }, [scoringId, actualEnergy, actualMood, actualFocus, load]);

  const togglePin = useCallback(async (f: Forecast) => {
    await fetch(`/api/energy-forecasts/${f.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: !f.pinned }),
    });
    await load();
  }, [load]);

  const remove = useCallback(async (f: Forecast) => {
    if (!confirm(`Delete forecast for ${f.forecast_date}?`)) return;
    await fetch(`/api/energy-forecasts/${f.id}`, { method: "DELETE" });
    await load();
  }, [load]);

  const dateOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (let i = 0; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const iso = d.toISOString().slice(0, 10);
      out.push({ value: iso, label: i === 0 ? "today" : i === 1 ? "tomorrow" : `${dowName(iso)} ${iso.slice(5)}` });
    }
    return out;
  }, []);

  const STATUSES: { value: Status; label: string }[] = [
    { value: "all", label: "all" },
    { value: "upcoming", label: "upcoming" },
    { value: "scored", label: "scored" },
    { value: "unscored", label: "unscored" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#e8e0d2" }}>
      <div style={{ background: "#1a1813", border: "1px solid #2a2620", borderRadius: 6, padding: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11, color: "#9aa28e", letterSpacing: 1 }}>FORECAST A DAY</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {dateOptions.map((d) => (
              <button
                key={d.value}
                onClick={() => setTargetDate(d.value)}
                style={{
                  padding: "5px 10px",
                  background: targetDate === d.value ? "#2a2620" : "transparent",
                  color: targetDate === d.value ? "#bfd4ee" : "#9aa28e",
                  border: `1px solid ${targetDate === d.value ? "#bfd4ee" : "#2a2620"}`,
                  borderRadius: 3,
                  fontSize: 11,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
          <button
            onClick={generate}
            disabled={generating}
            style={{
              alignSelf: "flex-start",
              padding: "8px 16px",
              background: "#0e0c08",
              color: "#bfd4ee",
              border: "1px solid #bfd4ee",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "inherit",
              cursor: generating ? "wait" : "pointer",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {generating ? "…modelling" : `Forecast ${targetDate}`}
          </button>
        </div>
      </div>

      {calibration && (
        <div style={{ background: "#1a1813", border: "1px solid #2a2620", borderLeft: "3px solid #7affcb", borderRadius: 6, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11, color: "#9aa28e", letterSpacing: 1 }}>CALIBRATION</div>
            <div style={{ fontSize: 22, color: "#7affcb" }}>
              {calibration.avg_accuracy.toFixed(1)}<span style={{ fontSize: 12, color: "#9aa28e" }}>/5</span>
            </div>
            <div style={{ fontSize: 11, color: "#9aa28e" }}>across {calibration.scored} scored forecasts</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#9aa28e", letterSpacing: 1 }}>STATUS</span>
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatus(s.value)}
            style={{
              padding: "4px 10px",
              background: status === s.value ? "#2a2620" : "transparent",
              color: status === s.value ? "#e8e0d2" : "#9aa28e",
              border: `1px solid ${status === s.value ? "#5c5a52" : "#2a2620"}`,
              borderRadius: 3,
              fontSize: 11,
              fontFamily: "inherit",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: "#2a1010", border: "1px solid #ff6b6b", color: "#ff6b6b", padding: 10, borderRadius: 4, fontSize: 12 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ color: "#9aa28e", fontSize: 12 }}>loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: "#9aa28e", fontSize: 12, padding: 24, textAlign: "center", background: "#1a1813", border: "1px solid #2a2620", borderRadius: 6 }}>
          No forecasts yet. Pick a date above and forecast.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((f) => {
            const scored = f.scored_at != null;
            const isPast = f.forecast_date < todayDate();
            return (
              <div
                key={f.id}
                style={{
                  background: "#1a1813",
                  border: "1px solid #2a2620",
                  borderLeft: `3px solid ${scored ? "#7affcb" : isPast ? "#fbb86d" : "#bfd4ee"}`,
                  borderRadius: 6,
                  padding: 14,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, color: "#e8e0d2" }}>{f.forecast_date}</span>
                    <span style={{ fontSize: 11, color: "#9aa28e" }}>{dowName(f.forecast_date)} · {relDay(f.forecast_date)}</span>
                    {f.pinned && <span style={{ fontSize: 10, color: "#fbb86d" }}>★</span>}
                    {scored && (
                      <span style={{ fontSize: 10, color: "#7affcb", padding: "2px 6px", border: "1px solid #7affcb", borderRadius: 3, textTransform: "uppercase", letterSpacing: 1 }}>
                        accuracy {f.accuracy_score}/5
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#5c5a52" }}>
                    {f.latency_ms != null && `${(f.latency_ms / 1000).toFixed(1)}s`}
                    {f.model && ` · ${f.model.includes("haiku") ? "haiku" : "sonnet"}`}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 10, color: "#5c5a52", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Energy</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, color: "#bfd4ee" }}>{f.energy_pred}</span>
                      {dotMeter(f.energy_pred, 5, "#bfd4ee")}
                      {scored && f.actual_energy != null && (
                        <span style={{ fontSize: 11, color: f.actual_energy === f.energy_pred ? "#7affcb" : "#fbb86d" }}>→ {f.actual_energy}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#5c5a52", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Mood</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, color: "#f4c9d8" }}>{f.mood_pred}</span>
                      {dotMeter(f.mood_pred, 5, "#f4c9d8")}
                      {scored && f.actual_mood != null && (
                        <span style={{ fontSize: 11, color: f.actual_mood === f.mood_pred ? "#7affcb" : "#fbb86d" }}>→ {f.actual_mood}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#5c5a52", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Focus</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, color: "#7affcb" }}>{f.focus_pred}</span>
                      {dotMeter(f.focus_pred, 5, "#7affcb")}
                      {scored && f.actual_focus != null && (
                        <span style={{ fontSize: 11, color: f.actual_focus === f.focus_pred ? "#7affcb" : "#fbb86d" }}>→ {f.actual_focus}</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "#5c5a52", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Confidence</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 18, color: "#9aa28e" }}>{f.confidence}</span>
                      {dotMeter(f.confidence, 5, "#9aa28e")}
                    </div>
                  </div>
                </div>

                <div style={{ background: "#0e0c08", border: "1px solid #2a2620", borderRadius: 4, padding: 12, marginBottom: 10 }}>
                  <div style={{ fontSize: 14, color: "#e8e0d2", lineHeight: 1.6, fontFamily: "Georgia, serif" }}>
                    {f.narrative}
                  </div>
                </div>

                {f.recommendations && f.recommendations.length > 0 && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, color: "#5c5a52", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Recommendations</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "#e8e0d2", fontSize: 12, lineHeight: 1.7 }}>
                      {f.recommendations.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {f.source_summary && (
                  <div style={{ fontSize: 10, color: "#5c5a52", marginBottom: 8, fontStyle: "italic" }}>
                    {f.source_summary}
                  </div>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                  {!scored && isPast && (
                    <button
                      onClick={() => openScoring(f)}
                      style={{ padding: "6px 12px", background: "#0e0c08", color: "#7affcb", border: "1px solid #7affcb", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
                    >
                      Score actuals
                    </button>
                  )}
                  {scored && (
                    <button
                      onClick={() => openScoring(f)}
                      style={{ padding: "6px 12px", background: "#0e0c08", color: "#9aa28e", border: "1px solid #5c5a52", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
                    >
                      Edit score
                    </button>
                  )}
                  <button
                    onClick={() => togglePin(f)}
                    style={{ padding: "6px 12px", background: "transparent", color: f.pinned ? "#fbb86d" : "#9aa28e", border: `1px solid ${f.pinned ? "#fbb86d" : "#2a2620"}`, borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
                  >
                    {f.pinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    onClick={() => remove(f)}
                    style={{ padding: "6px 12px", background: "transparent", color: "#5c5a52", border: "1px solid #2a2620", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1, marginLeft: "auto" }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {scoringId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}>
          <div style={{ background: "#1a1813", border: "1px solid #5c5a52", borderRadius: 8, padding: 20, maxWidth: 460, width: "100%" }}>
            <div style={{ fontSize: 11, color: "#9aa28e", letterSpacing: 1, marginBottom: 14 }}>HOW DID THE DAY ACTUALLY FEEL?</div>
            {[
              { label: "Energy", value: actualEnergy, set: setActualEnergy, color: "#bfd4ee" },
              { label: "Mood", value: actualMood, set: setActualMood, color: "#f4c9d8" },
              { label: "Focus", value: actualFocus, set: setActualFocus, color: "#7affcb" },
            ].map((row) => (
              <div key={row.label} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "#9aa28e", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>{row.label}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => row.set(n)}
                      style={{
                        flex: 1,
                        padding: "10px 0",
                        background: row.value === n ? row.color : "#0e0c08",
                        color: row.value === n ? "#0e0c08" : row.color,
                        border: `1px solid ${row.color}`,
                        borderRadius: 3,
                        fontSize: 14,
                        fontFamily: "inherit",
                        cursor: "pointer",
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={saveScore}
                disabled={savingScore}
                style={{ flex: 1, padding: "10px 16px", background: "#0e0c08", color: "#7affcb", border: "1px solid #7affcb", borderRadius: 3, fontSize: 12, fontFamily: "inherit", cursor: savingScore ? "wait" : "pointer", textTransform: "uppercase", letterSpacing: 1 }}
              >
                {savingScore ? "…saving" : "Save"}
              </button>
              <button
                onClick={() => setScoringId(null)}
                style={{ padding: "10px 16px", background: "transparent", color: "#9aa28e", border: "1px solid #2a2620", borderRadius: 3, fontSize: 12, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
