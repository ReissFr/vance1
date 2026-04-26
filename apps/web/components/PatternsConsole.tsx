"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Example = { date: string; antecedent_evidence: string; consequent_evidence: string };

type Pattern = {
  id: string;
  scan_id: string;
  relation_kind: string;
  antecedent: string;
  consequent: string;
  statement: string;
  nuance: string | null;
  domain: string;
  direction: "positive" | "negative" | "neither";
  lift: number | null;
  support_count: number | null;
  total_count: number | null;
  strength: number;
  source_signal: string | null;
  examples: Example[];
  candidate_intervention: string | null;
  user_status: "confirmed" | "contested" | "dismissed" | null;
  user_note: string | null;
  pinned: boolean;
  archived_at: string | null;
  resolved_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Status = "open" | "confirmed" | "contested" | "dismissed" | "archived" | "all";

const DOMAIN_TINT: Record<string, string> = {
  energy: "#fbb86d",
  mood: "#f4c9d8",
  focus: "#bfd4ee",
  time: "#e8d8b0",
  decisions: "#7affcb",
  relationships: "#f4c9d8",
  work: "#bfd4ee",
  habits: "#7affcb",
  money: "#9aa28e",
  mixed: "#e8e0d2",
};

const RELATION_LABEL: Record<string, string> = {
  correlation: "correlation",
  sequence: "sequence",
  cluster: "cluster",
  threshold: "threshold",
  compound: "compound",
};

const DOMAINS = ["energy", "mood", "focus", "time", "decisions", "relationships", "work", "habits", "money", "mixed"];

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

function ArrowIcon({ direction }: { direction: "positive" | "negative" | "neither" }) {
  if (direction === "positive") return <span style={{ color: "#7affcb" }}>↑</span>;
  if (direction === "negative") return <span style={{ color: "#f4c9d8" }}>↓</span>;
  return <span style={{ color: "#9aa28e" }}>↔</span>;
}

export function PatternsConsole() {
  const [rows, setRows] = useState<Pattern[]>([]);
  const [status, setStatus] = useState<Status>("open");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; signals?: Record<string, number>; latency_ms?: number } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(120);
  const [composeDomain, setComposeDomain] = useState<string | null>(null);

  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("limit", "100");
      if (domainFilter) params.set("domain", domainFilter);
      const r = await fetch(`/api/patterns?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { patterns: Pattern[] };
      setRows(j.patterns);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, domainFilter]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const body: Record<string, unknown> = { window_days: composeWindow };
      if (composeDomain) body.domain_focus = composeDomain;
      const r = await fetch(`/api/patterns/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; signals?: Record<string, number>; latency_ms?: number };
      setScanResult({ inserted: j.inserted, signals: j.signals, latency_ms: j.latency_ms });
      setComposeOpen(false);
      setStatus("open");
      await load();
      setTimeout(() => setScanResult(null), 8000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const respond = async (id: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const r = await fetch(`/api/patterns/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const e = await r.text();
        throw new Error(`HTTP ${r.status}: ${e.slice(0, 200)}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this pattern? Cannot be undone.")) return;
    setError(null);
    try {
      const r = await fetch(`/api/patterns/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = useMemo(() => {
    const c: Record<Status, number> = { open: 0, confirmed: 0, contested: 0, dismissed: 0, archived: 0, all: rows.length };
    for (const r of rows) {
      if (r.archived_at) c.archived += 1;
      else if (r.user_status === "confirmed") c.confirmed += 1;
      else if (r.user_status === "contested") c.contested += 1;
      else if (r.user_status === "dismissed") c.dismissed += 1;
      else c.open += 1;
    }
    return c;
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 18, color: "#f0e6d2", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
      {/* Top action row */}
      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        <button
          onClick={() => setComposeOpen(true)}
          disabled={scanning}
          style={{ flex: "1 1 360px", background: "transparent", border: "1px solid #fbb86d", color: "#fbb86d", padding: "12px 16px", borderRadius: 4, cursor: "pointer", fontWeight: 600, letterSpacing: 1, textAlign: "left", fontFamily: "inherit" }}
        >
          <div style={{ fontSize: 13, opacity: 0.95, textTransform: "uppercase" }}>{scanning ? "scanning your data..." : "scan for patterns"}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4, fontWeight: 400, letterSpacing: 0 }}>look across check-ins / standups / intentions / decisions / wins / habit-logs and surface causal patterns</div>
        </button>
      </div>

      {scanResult && (
        <div style={{ background: "#1f2418", border: "1px solid #7affcb", color: "#7affcb", padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
          {scanResult.inserted} new pattern{scanResult.inserted === 1 ? "" : "s"} found
          {scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}
          {scanResult.signals ? ` · seed signals: ${Object.entries(scanResult.signals).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}
        </div>
      )}
      {error && <div style={{ background: "#2a1a1a", border: "1px solid #f4c9d8", color: "#f4c9d8", padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>{error}</div>}

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {(["open", "confirmed", "contested", "dismissed", "archived", "all"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{ background: status === s ? "#fbb86d" : "transparent", color: status === s ? "#1a1614" : "#9aa28e", border: `1px solid ${status === s ? "#fbb86d" : "#3a3530"}`, padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}
          >
            {s} {status === s ? `(${counts[s]})` : ""}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: "#3a3530", margin: "0 6px" }} />
        <span style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5 }}>domain:</span>
        <button
          onClick={() => setDomainFilter(null)}
          style={{ background: domainFilter == null ? "#3a3530" : "transparent", color: domainFilter == null ? "#f0e6d2" : "#5a544c", border: "1px solid #3a3530", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}
        >
          all
        </button>
        {DOMAINS.map((d) => (
          <button
            key={d}
            onClick={() => setDomainFilter(d)}
            style={{ background: domainFilter === d ? DOMAIN_TINT[d] : "transparent", color: domainFilter === d ? "#1a1614" : "#5a544c", border: `1px solid ${domainFilter === d ? DOMAIN_TINT[d] : "#3a3530"}`, padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Compose modal */}
      {composeOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setComposeOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#13110f", border: "1px solid #3a3530", borderRadius: 4, padding: 22, width: "min(560px, 92vw)", color: "#f0e6d2", fontFamily: "inherit" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#fbb86d", letterSpacing: 1, marginBottom: 4 }}>SCAN FOR PATTERNS</div>
            <div style={{ fontSize: 12, color: "#9aa28e", marginBottom: 16, lineHeight: 1.5 }}>
              looks across your check-ins, standups, intentions, decisions, wins, habit-logs, and reflections in the chosen window. computes seed statistics server-side, then asks Haiku for the strongest causal patterns. takes 8-15 seconds.
            </div>

            <label style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5 }}>window (days back)</label>
            <input
              type="number"
              min={30}
              max={365}
              value={composeWindow}
              onChange={(e) => setComposeWindow(Math.max(30, Math.min(365, parseInt(e.target.value, 10) || 120)))}
              style={{ width: "100%", background: "#0d0c0a", border: "1px solid #3a3530", color: "#f0e6d2", padding: "8px 10px", borderRadius: 4, fontFamily: "inherit", fontSize: 13, marginTop: 4, marginBottom: 6 }}
            />
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {[60, 90, 120, 180, 365].map((n) => (
                <button key={n} type="button" onClick={() => setComposeWindow(n)} style={{ background: composeWindow === n ? "#3a3530" : "transparent", color: "#9aa28e", border: "1px solid #3a3530", padding: "3px 7px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                  {n}d
                </button>
              ))}
            </div>

            <label style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5 }}>domain focus (optional)</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, marginBottom: 18 }}>
              <button type="button" onClick={() => setComposeDomain(null)} style={{ background: composeDomain == null ? "#3a3530" : "transparent", color: composeDomain == null ? "#f0e6d2" : "#5a544c", border: "1px solid #3a3530", padding: "4px 8px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>any</button>
              {DOMAINS.map((d) => (
                <button key={d} type="button" onClick={() => setComposeDomain(d)} style={{ background: composeDomain === d ? DOMAIN_TINT[d] : "transparent", color: composeDomain === d ? "#1a1614" : "#5a544c", border: `1px solid ${composeDomain === d ? DOMAIN_TINT[d] : "#3a3530"}`, padding: "4px 8px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>{d}</button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setComposeOpen(false)} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "8px 14px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>cancel</button>
              <button onClick={runScan} disabled={scanning} style={{ background: "transparent", border: "1px solid #fbb86d", color: "#fbb86d", padding: "8px 14px", borderRadius: 4, cursor: scanning ? "wait" : "pointer", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "inherit" }}>{scanning ? "scanning..." : "scan"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && <div style={{ color: "#9aa28e", fontSize: 12 }}>loading...</div>}
        {!loading && rows.length === 0 && (
          <div style={{ color: "#5a544c", fontSize: 12, fontStyle: "italic", padding: 24, textAlign: "center" }}>
            no patterns yet. scan to surface causal links in your own data.
          </div>
        )}
        {rows.map((p) => {
          const tint = DOMAIN_TINT[p.domain] ?? "#9aa28e";
          const supportLabel = p.support_count != null && p.total_count != null ? `${p.support_count}/${p.total_count}` : null;
          const isOpen = !p.archived_at && p.user_status == null;
          return (
            <div key={p.id} style={{ background: "#13110f", border: "1px solid #2a2620", borderLeft: `3px solid ${tint}`, borderRadius: 4, padding: 16 }}>
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ color: tint, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{p.domain}</span>
                <span style={{ color: "#5a544c", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{RELATION_LABEL[p.relation_kind] ?? p.relation_kind}</span>
                <ArrowIcon direction={p.direction} />
                {dotMeter(p.strength, tint)}
                {supportLabel && <span style={{ color: "#9aa28e", fontSize: 11 }}>{supportLabel}</span>}
                {p.lift != null && <span style={{ color: "#9aa28e", fontSize: 11 }}>lift {p.lift.toFixed(2)}×</span>}
                {p.user_status && (
                  <span style={{ background: p.user_status === "confirmed" ? "#1f2418" : p.user_status === "contested" ? "#2a2418" : "#1a1614", color: p.user_status === "confirmed" ? "#7affcb" : p.user_status === "contested" ? "#fbb86d" : "#9aa28e", border: `1px solid ${p.user_status === "confirmed" ? "#7affcb" : p.user_status === "contested" ? "#fbb86d" : "#3a3530"}`, padding: "2px 7px", borderRadius: 10, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    {p.user_status} {relTime(p.resolved_at)}
                  </span>
                )}
                {p.pinned && <span style={{ color: "#fbb86d", fontSize: 11 }}>★</span>}
                <span style={{ marginLeft: "auto", color: "#5a544c", fontSize: 10 }}>{relTime(p.created_at)}</span>
              </div>

              {/* Statement (the line) */}
              <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 17, lineHeight: 1.45, color: "#f0e6d2", marginBottom: 8 }}>
                {p.statement}
              </div>

              {p.nuance && (
                <div style={{ fontFamily: "Georgia, serif", fontSize: 13, fontStyle: "italic", color: "#9aa28e", marginBottom: 12, lineHeight: 1.5 }}>
                  {p.nuance}
                </div>
              )}

              {/* Antecedent → consequent */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#0d0c0a", borderRadius: 4, marginBottom: 12, flexWrap: "wrap", fontSize: 11 }}>
                <span style={{ color: "#9aa28e" }}>{p.antecedent}</span>
                <span style={{ color: tint }}>→</span>
                <span style={{ color: "#f0e6d2" }}>{p.consequent}</span>
                {p.source_signal && <span style={{ marginLeft: "auto", color: "#5a544c", fontSize: 10 }}>{p.source_signal}</span>}
              </div>

              {/* Examples */}
              {p.examples.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>examples</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {p.examples.map((ex, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#9aa28e", lineHeight: 1.5 }}>
                        <span style={{ color: "#5a544c", fontFamily: "ui-monospace, monospace", fontSize: 10, minWidth: 80, paddingTop: 2 }}>{ex.date}</span>
                        <span style={{ flex: 1 }}>
                          <span style={{ color: "#9aa28e" }}>{ex.antecedent_evidence}</span>
                          <span style={{ color: tint, margin: "0 6px" }}>→</span>
                          <span style={{ color: "#f0e6d2" }}>{ex.consequent_evidence}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Candidate intervention */}
              {p.candidate_intervention && (
                <div style={{ background: "#1a1410", border: `1px solid ${tint}`, borderRadius: 4, padding: "8px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: tint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>a lever you could pull</div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 13, color: "#f0e6d2", fontStyle: "italic", lineHeight: 1.5 }}>{p.candidate_intervention}</div>
                </div>
              )}

              {/* User note */}
              {p.user_note && (
                <div style={{ marginBottom: 10, padding: "8px 12px", background: "#0d0c0a", borderLeft: `2px solid ${tint}`, color: "#9aa28e", fontSize: 12, lineHeight: 1.5 }}>
                  {p.user_note}
                </div>
              )}

              {/* Note compose */}
              {noteOpenId === p.id && (
                <div style={{ marginBottom: 10 }}>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="add a note..."
                    rows={3}
                    style={{ width: "100%", background: "#0d0c0a", border: "1px solid #3a3530", color: "#f0e6d2", padding: 8, borderRadius: 4, fontFamily: "inherit", fontSize: 12, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button onClick={async () => { await respond(p.id, { user_note: noteDraft }); setNoteOpenId(null); setNoteDraft(""); }} style={{ background: "transparent", border: "1px solid #7affcb", color: "#7affcb", padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>save</button>
                    <button onClick={() => { setNoteOpenId(null); setNoteDraft(""); }} style={{ background: "transparent", border: "1px solid #3a3530", color: "#5a544c", padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>cancel</button>
                  </div>
                </div>
              )}

              {/* Action row */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {isOpen && (
                  <>
                    <button onClick={() => respond(p.id, { status: "confirmed" })} style={{ background: "transparent", border: "1px solid #7affcb", color: "#7affcb", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>confirm</button>
                    <button onClick={() => respond(p.id, { status: "contested" })} style={{ background: "transparent", border: "1px solid #fbb86d", color: "#fbb86d", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>contest</button>
                    <button onClick={() => respond(p.id, { status: "dismissed" })} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>dismiss</button>
                    <button onClick={() => { setNoteOpenId(p.id); setNoteDraft(p.user_note ?? ""); }} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>+ note</button>
                  </>
                )}
                <span style={{ flex: 1 }} />
                <button onClick={() => respond(p.id, { pin: !p.pinned })} style={{ background: "transparent", border: "1px solid #3a3530", color: p.pinned ? "#fbb86d" : "#5a544c", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>{p.pinned ? "unpin" : "pin"}</button>
                {p.archived_at ? (
                  <button onClick={() => respond(p.id, { restore: true })} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>restore</button>
                ) : (
                  <button onClick={() => respond(p.id, { archive: true })} style={{ background: "transparent", border: "1px solid #3a3530", color: "#5a544c", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>archive</button>
                )}
                <button onClick={() => remove(p.id)} style={{ background: "transparent", border: "1px solid #3a3530", color: "#5a544c", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
