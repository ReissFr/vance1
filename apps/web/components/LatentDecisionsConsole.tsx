"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type LatentDecision = {
  id: string;
  scan_id: string;
  kind: string;
  label: string;
  candidate_decision: string;
  evidence_summary: string | null;
  evidence_old: unknown[];
  evidence_new: unknown[];
  strength: number;
  source_signal: string | null;
  user_status: "acknowledged" | "contested" | "dismissed" | null;
  user_note: string | null;
  resulting_decision_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  resolved_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Status = "open" | "acknowledged" | "contested" | "dismissed" | "archived" | "all";

const KIND_TINT: Record<string, string> = {
  person: "#f4c9d8",
  theme: "#fbb86d",
  habit: "#7affcb",
  routine: "#bfd4ee",
  topic: "#e8e0d2",
  practice: "#9aa28e",
  place: "#bfd4ee",
  identity: "#f4c9d8",
  other: "#9aa28e",
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

function dotMeter(score: number, color = "#fbb86d"): React.ReactNode {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: 7, background: i < score ? color : "#2a2620", display: "inline-block" }} />
      ))}
    </span>
  );
}

export function LatentDecisionsConsole() {
  const [rows, setRows] = useState<LatentDecision[]>([]);
  const [status, setStatus] = useState<Status>("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; signals?: Record<string, number>; latency_ms?: number } | null>(null);

  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/latent-decisions?status=${status}&limit=100`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { latent_decisions: LatentDecision[] };
      setRows(j.latent_decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const r = await fetch(`/api/latent-decisions/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { inserted: number; signals?: Record<string, number>; latency_ms?: number };
      setScanResult(j);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await fetch(`/api/latent-decisions/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { latent_decision: LatentDecision };
      setRows((prev) => prev.map((p) => (p.id === id ? j.latent_decision : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this candidate forever?")) return;
    setError(null);
    try {
      const r = await fetch(`/api/latent-decisions/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRows((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = useMemo(() => {
    const c = { open: 0, acknowledged: 0, contested: 0, dismissed: 0, archived: 0 };
    for (const p of rows) {
      if (p.archived_at != null) c.archived += 1;
      else if (p.user_status === "acknowledged") c.acknowledged += 1;
      else if (p.user_status === "contested") c.contested += 1;
      else if (p.user_status === "dismissed") c.dismissed += 1;
      else c.open += 1;
    }
    return c;
  }, [rows]);

  const pills: Array<{ id: Status; label: string; count?: number }> = [
    { id: "open", label: "Open", count: counts.open },
    { id: "acknowledged", label: "Acknowledged", count: counts.acknowledged },
    { id: "contested", label: "Contested", count: counts.contested },
    { id: "dismissed", label: "Dismissed", count: counts.dismissed },
    { id: "archived", label: "Archived", count: counts.archived },
    { id: "all", label: "All" },
  ];

  return (
    <div style={{ padding: "8px 14px 28px", color: "#e8e0d2", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 13 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <button disabled={scanning} onClick={runScan} style={btn("#fbb86d")}>{scanning ? "Scanning…" : "Scan for latent decisions"}</button>
        <span style={{ opacity: 0.55, fontSize: 11 }}>compares the last 30 days against the 90-180-days-ago window</span>
        <span style={{ flex: 1 }} />
        <span style={{ opacity: 0.55, fontSize: 11 }}>{rows.length} in current view</span>
      </div>

      {scanResult && (
        <div style={{ background: "#1a1a0f", border: "1px solid #fbb86d", color: "#f8d8a0", padding: "10px 14px", borderRadius: 6, marginBottom: 14, fontSize: 12 }}>
          Scan complete · {scanResult.inserted} new latent decision{scanResult.inserted === 1 ? "" : "s"} found{scanResult.signals ? ` · signals: ${scanResult.signals.person_drops ?? 0} people, ${scanResult.signals.habit_drops ?? 0} habits, ${scanResult.signals.theme_declines ?? 0} themes` : ""}{scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}
        </div>
      )}

      {error && <div style={{ background: "#3a1a1a", border: "1px solid #ff6b6b", color: "#ffb0b0", padding: "8px 12px", borderRadius: 6, marginBottom: 14, fontSize: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18, borderBottom: "1px solid #2a2620", paddingBottom: 10 }}>
        {pills.map((p) => (
          <button
            key={p.id}
            onClick={() => setStatus(p.id)}
            style={{
              padding: "6px 12px",
              borderRadius: 14,
              border: "1px solid #2a2620",
              background: status === p.id ? "#fbb86d" : "transparent",
              color: status === p.id ? "#1a1612" : "#e8e0d2",
              fontFamily: "inherit",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {p.label}{p.count != null && <span style={{ opacity: 0.5, marginLeft: 4 }}>{p.count}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ opacity: 0.55, fontSize: 12 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ opacity: 0.55, fontSize: 12, padding: "30px 0" }}>
          {status === "open" ? "No open latent decisions. Run a scan to surface what's drifted." : `No ${status} candidates yet.`}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {rows.map((d) => {
            const tint = KIND_TINT[d.kind] ?? "#9aa28e";
            const isOpen = d.user_status == null && d.archived_at == null;
            return (
              <div key={d.id} style={{ borderLeft: `3px solid ${tint}`, background: "#16120e", padding: "14px 18px", borderRadius: 4, opacity: d.archived_at ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ color: tint, fontSize: 10, letterSpacing: 1 }}>{d.kind.toUpperCase()}</span>
                  <span style={{ fontSize: 11, opacity: 0.7 }}>{d.label}</span>
                  {dotMeter(d.strength, tint)}
                  {d.user_status && <span style={{ fontSize: 10, opacity: 0.6, fontStyle: "italic" }}>{d.user_status}</span>}
                  {d.pinned && <span style={{ color: "#f4c9d8", fontSize: 11 }}>★</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ opacity: 0.45, fontSize: 10 }}>{relTime(d.created_at)}</span>
                </div>

                <div style={{ marginTop: 10, fontFamily: "Georgia, serif", fontSize: 17, lineHeight: 1.4, color: "#e8e0d2" }}>{d.candidate_decision}</div>

                {d.evidence_summary && (
                  <div style={{ marginTop: 8, fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.5, color: "#cfc7b8", fontStyle: "italic" }}>{d.evidence_summary}</div>
                )}

                <div style={{ marginTop: 6, fontSize: 10, opacity: 0.4 }}>
                  {d.source_signal ? `signal: ${d.source_signal}` : ""}
                  {d.resulting_decision_id ? ` · materialised as decision` : ""}
                </div>

                {/* User note */}
                {(d.user_note || noteOpenId === d.id) && (
                  <div style={{ marginTop: 12, padding: "10px 12px", background: "#0e0c0a", borderRadius: 4, border: "1px solid #2a2620" }}>
                    <div style={{ fontSize: 10, letterSpacing: 1, opacity: 0.6, marginBottom: 6 }}>YOUR NOTE</div>
                    {noteOpenId === d.id ? (
                      <>
                        <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} placeholder="Anything you want to record about this..." style={inp} />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={async () => { await patch(d.id, { user_note: noteDraft }); setNoteOpenId(null); }} style={{ ...btn("#7affcb"), padding: "4px 10px", fontSize: 11 }}>Save</button>
                          <button onClick={() => setNoteOpenId(null)} style={{ ...btn("#3a3530"), color: "#e8e0d2", padding: "4px 10px", fontSize: 11 }}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontFamily: "Georgia, serif", fontSize: 13, lineHeight: 1.5, color: "#cfc7b8" }}>{d.user_note}</div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                  {isOpen && (
                    <>
                      <button onClick={() => patch(d.id, { status: "acknowledged" })} style={{ ...btn("#7affcb"), fontSize: 11, padding: "4px 12px" }}>Acknowledge</button>
                      <button onClick={() => patch(d.id, { status: "contested" })} style={{ ...btn("#fbb86d"), fontSize: 11, padding: "4px 12px" }}>Contest</button>
                      <button onClick={() => patch(d.id, { status: "dismissed" })} style={{ ...btn("#3a3530"), color: "#e8e0d2", fontSize: 11, padding: "4px 12px" }}>Dismiss</button>
                      {!d.resulting_decision_id && (
                        <button onClick={() => patch(d.id, { create_decision: true })} style={{ ...btn("transparent"), border: "1px solid #bfd4ee", color: "#bfd4ee", fontSize: 11, padding: "4px 12px" }}>Materialise as decision</button>
                      )}
                    </>
                  )}
                  <button onClick={() => { setNoteOpenId(d.id); setNoteDraft(d.user_note ?? ""); }} style={{ ...btn("transparent"), color: "#e8e0d2", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>{d.user_note ? "Edit note" : "Add note"}</button>
                  <button onClick={() => patch(d.id, { pin: !d.pinned })} style={{ ...btn("transparent"), color: "#f4c9d8", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>{d.pinned ? "Unpin" : "Pin"}</button>
                  {d.archived_at != null ? (
                    <button onClick={() => patch(d.id, { restore: true })} style={{ ...btn("transparent"), color: "#7affcb", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>Restore</button>
                  ) : (
                    <button onClick={() => patch(d.id, { archive: true })} style={{ ...btn("transparent"), color: "#9aa28e", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>Archive</button>
                  )}
                  <span style={{ flex: 1 }} />
                  <button onClick={() => remove(d.id)} style={{ ...btn("transparent"), color: "#ff6b6b", border: "1px solid #2a2620", fontSize: 11, padding: "3px 10px" }}>Delete</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "#1a1612",
    border: "none",
    padding: "6px 14px",
    borderRadius: 4,
    fontFamily: "inherit",
    fontSize: 12,
    cursor: "pointer",
    fontWeight: 500,
  };
}

const inp: React.CSSProperties = { width: "100%", background: "#0e0c0a", border: "1px solid #2a2620", color: "#e8e0d2", padding: "8px 10px", borderRadius: 4, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12, marginBottom: 6, boxSizing: "border-box" };
