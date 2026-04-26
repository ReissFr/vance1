"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Quote = { date: string; snippet: string; conversation_id_prefix?: string };

type Loop = {
  id: string;
  scan_id: string;
  loop_label: string;
  recurring_question: string;
  pattern_summary: string;
  domain: string;
  occurrence_count: number;
  span_days: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  sample_quotes: Quote[];
  candidate_exit: string | null;
  strength: number;
  user_status: "named" | "resolved" | "contested" | "dismissed" | null;
  user_note: string | null;
  resolution_text: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Status = "open" | "named" | "resolved" | "contested" | "dismissed" | "archived" | "all";

const DOMAIN_TINT: Record<string, string> = {
  energy: "#fbb86d",
  mood: "#f4c9d8",
  focus: "#bfd4ee",
  time: "#e8d8b0",
  decisions: "#7affcb",
  relationships: "#f4c9d8",
  work: "#bfd4ee",
  identity: "#c9b3f4",
  money: "#9aa28e",
  mixed: "#e8e0d2",
};

const DOMAINS = ["energy", "mood", "focus", "time", "decisions", "relationships", "work", "identity", "money", "mixed"];

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

export function ConversationLoopsConsole() {
  const [rows, setRows] = useState<Loop[]>([]);
  const [status, setStatus] = useState<Status>("open");
  const [domainFilter, setDomainFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; signals?: Record<string, number>; latency_ms?: number } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(60);
  const [composeMinOcc, setComposeMinOcc] = useState(4);

  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveDraft, setResolveDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("limit", "100");
      if (domainFilter) params.set("domain", domainFilter);
      const r = await fetch(`/api/conversation-loops?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { conversation_loops: Loop[] };
      setRows(j.conversation_loops);
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
      const body: Record<string, unknown> = { window_days: composeWindow, min_occurrences: composeMinOcc };
      const r = await fetch(`/api/conversation-loops/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
      const r = await fetch(`/api/conversation-loops/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
    if (!confirm("Delete this loop? Cannot be undone.")) return;
    setError(null);
    try {
      const r = await fetch(`/api/conversation-loops/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = useMemo(() => {
    const c: Record<Status, number> = { open: 0, named: 0, resolved: 0, contested: 0, dismissed: 0, archived: 0, all: rows.length };
    for (const r of rows) {
      if (r.archived_at) c.archived += 1;
      else if (r.user_status === "named") c.named += 1;
      else if (r.user_status === "resolved") c.resolved += 1;
      else if (r.user_status === "contested") c.contested += 1;
      else if (r.user_status === "dismissed") c.dismissed += 1;
      else c.open += 1;
    }
    return c;
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 18, color: "#f0e6d2", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        <button
          onClick={() => setComposeOpen(true)}
          disabled={scanning}
          style={{ flex: "1 1 360px", background: "transparent", border: "1px solid #c9b3f4", color: "#c9b3f4", padding: "12px 16px", borderRadius: 4, cursor: "pointer", fontWeight: 600, letterSpacing: 1, textAlign: "left", fontFamily: "inherit" }}
        >
          <div style={{ fontSize: 13, opacity: 0.95, textTransform: "uppercase" }}>{scanning ? "scanning your messages..." : "scan for loops"}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4, fontWeight: 400, letterSpacing: 0 }}>mine your own messages across recent conversations and surface the questions you keep circling</div>
        </button>
      </div>

      {scanResult && (
        <div style={{ background: "#1f2418", border: "1px solid #7affcb", color: "#7affcb", padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
          {scanResult.inserted} new loop{scanResult.inserted === 1 ? "" : "s"} found
          {scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}
          {scanResult.signals ? ` · scanned: ${Object.entries(scanResult.signals).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}
        </div>
      )}
      {error && <div style={{ background: "#2a1a1a", border: "1px solid #f4c9d8", color: "#f4c9d8", padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>{error}</div>}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {(["open", "named", "resolved", "contested", "dismissed", "archived", "all"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{ background: status === s ? "#c9b3f4" : "transparent", color: status === s ? "#1a1614" : "#9aa28e", border: `1px solid ${status === s ? "#c9b3f4" : "#3a3530"}`, padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}
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

      {composeOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setComposeOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#13110f", border: "1px solid #3a3530", borderRadius: 4, padding: 22, width: "min(560px, 92vw)", color: "#f0e6d2", fontFamily: "inherit" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#c9b3f4", letterSpacing: 1, marginBottom: 4 }}>SCAN FOR LOOPS</div>
            <div style={{ fontSize: 12, color: "#9aa28e", marginBottom: 16, lineHeight: 1.5 }}>
              reads your own messages across recent conversations, clusters them by topic and question shape, and surfaces the questions you keep circling. takes 6-12 seconds.
            </div>

            <label style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5 }}>window (days back)</label>
            <input
              type="number"
              min={14}
              max={180}
              value={composeWindow}
              onChange={(e) => setComposeWindow(Math.max(14, Math.min(180, parseInt(e.target.value, 10) || 60)))}
              style={{ width: "100%", background: "#0d0c0a", border: "1px solid #3a3530", color: "#f0e6d2", padding: "8px 10px", borderRadius: 4, fontFamily: "inherit", fontSize: 13, marginTop: 4, marginBottom: 6 }}
            />
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {[14, 30, 60, 90, 120, 180].map((n) => (
                <button key={n} type="button" onClick={() => setComposeWindow(n)} style={{ background: composeWindow === n ? "#3a3530" : "transparent", color: "#9aa28e", border: "1px solid #3a3530", padding: "3px 7px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                  {n}d
                </button>
              ))}
            </div>

            <label style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5 }}>min distinct conversations</label>
            <input
              type="number"
              min={3}
              max={20}
              value={composeMinOcc}
              onChange={(e) => setComposeMinOcc(Math.max(3, Math.min(20, parseInt(e.target.value, 10) || 4)))}
              style={{ width: "100%", background: "#0d0c0a", border: "1px solid #3a3530", color: "#f0e6d2", padding: "8px 10px", borderRadius: 4, fontFamily: "inherit", fontSize: 13, marginTop: 4, marginBottom: 6 }}
            />
            <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
              {[3, 4, 5, 6, 8, 10].map((n) => (
                <button key={n} type="button" onClick={() => setComposeMinOcc(n)} style={{ background: composeMinOcc === n ? "#3a3530" : "transparent", color: "#9aa28e", border: "1px solid #3a3530", padding: "3px 7px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                  {n}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setComposeOpen(false)} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "8px 14px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>cancel</button>
              <button onClick={runScan} disabled={scanning} style={{ background: "transparent", border: "1px solid #c9b3f4", color: "#c9b3f4", padding: "8px 14px", borderRadius: 4, cursor: scanning ? "wait" : "pointer", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "inherit" }}>{scanning ? "scanning..." : "scan"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {loading && <div style={{ color: "#9aa28e", fontSize: 12 }}>loading...</div>}
        {!loading && rows.length === 0 && (
          <div style={{ color: "#5a544c", fontSize: 12, fontStyle: "italic", padding: 24, textAlign: "center" }}>
            no loops yet. scan to surface the questions you keep circling.
          </div>
        )}
        {rows.map((p) => {
          const tint = DOMAIN_TINT[p.domain] ?? "#9aa28e";
          const isOpen = !p.archived_at && p.user_status == null;
          return (
            <div key={p.id} style={{ background: "#13110f", border: "1px solid #2a2620", borderLeft: `3px solid ${tint}`, borderRadius: 4, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ color: tint, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{p.domain}</span>
                {dotMeter(p.strength, tint)}
                <span style={{ color: "#9aa28e", fontSize: 11 }}>{p.occurrence_count} convos · {p.span_days}d span</span>
                {p.user_status && (
                  <span style={{
                    background: p.user_status === "resolved" ? "#1f2418" : p.user_status === "named" ? "#1f1a24" : p.user_status === "contested" ? "#2a2418" : "#1a1614",
                    color: p.user_status === "resolved" ? "#7affcb" : p.user_status === "named" ? "#c9b3f4" : p.user_status === "contested" ? "#fbb86d" : "#9aa28e",
                    border: `1px solid ${p.user_status === "resolved" ? "#7affcb" : p.user_status === "named" ? "#c9b3f4" : p.user_status === "contested" ? "#fbb86d" : "#3a3530"}`,
                    padding: "2px 7px", borderRadius: 10, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5,
                  }}>
                    {p.user_status} {relTime(p.resolved_at)}
                  </span>
                )}
                {p.pinned && <span style={{ color: "#fbb86d", fontSize: 11 }}>★</span>}
                <span style={{ marginLeft: "auto", color: "#5a544c", fontSize: 10 }}>{relTime(p.created_at)}</span>
              </div>

              <div style={{ fontSize: 15, fontWeight: 600, color: tint, marginBottom: 8, letterSpacing: 0.3 }}>
                {p.loop_label}
              </div>

              <div style={{ background: "#0d0c0a", borderLeft: `2px solid ${tint}`, padding: "10px 14px", marginBottom: 12, fontFamily: "Georgia, serif", fontSize: 15, fontStyle: "italic", color: "#f0e6d2", lineHeight: 1.5 }}>
                "{p.recurring_question}"
              </div>

              <div style={{ fontFamily: "Georgia, serif", fontSize: 14, color: "#c9c1ad", marginBottom: 12, lineHeight: 1.55 }}>
                {p.pattern_summary}
              </div>

              {p.sample_quotes.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>receipts</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {p.sample_quotes.map((q, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#9aa28e", lineHeight: 1.5 }}>
                        <span style={{ color: "#5a544c", fontFamily: "ui-monospace, monospace", fontSize: 10, minWidth: 80, paddingTop: 2 }}>{q.date}</span>
                        <span style={{ flex: 1, color: "#c9c1ad" }}>"{q.snippet}"</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {p.candidate_exit && (
                <div style={{ background: "#1a1410", border: `1px solid ${tint}`, borderRadius: 4, padding: "8px 12px", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: tint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>step out</div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 13, color: "#f0e6d2", fontStyle: "italic", lineHeight: 1.5 }}>{p.candidate_exit}</div>
                </div>
              )}

              {p.resolution_text && (
                <div style={{ background: "#0f1a14", border: "1px solid #7affcb", borderRadius: 4, padding: "10px 14px", marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#7affcb", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>your answer</div>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 14, color: "#f0e6d2", lineHeight: 1.55 }}>{p.resolution_text}</div>
                </div>
              )}

              {p.user_note && (
                <div style={{ marginBottom: 10, padding: "8px 12px", background: "#0d0c0a", borderLeft: `2px solid ${tint}`, color: "#9aa28e", fontSize: 12, lineHeight: 1.5 }}>
                  {p.user_note}
                </div>
              )}

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

              {resolveOpenId === p.id && (
                <div style={{ marginBottom: 10, background: "#0f1a14", border: "1px solid #7affcb", borderRadius: 4, padding: 12 }}>
                  <div style={{ fontSize: 10, color: "#7affcb", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>write your answer to the loop (min 8 chars)</div>
                  <textarea
                    value={resolveDraft}
                    onChange={(e) => setResolveDraft(e.target.value)}
                    placeholder="the answer, in your own voice..."
                    rows={4}
                    style={{ width: "100%", background: "#0d0c0a", border: "1px solid #3a3530", color: "#f0e6d2", padding: 8, borderRadius: 4, fontFamily: "Georgia, serif", fontSize: 13, resize: "vertical", lineHeight: 1.5 }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button
                      onClick={async () => {
                        if (resolveDraft.trim().length < 8) { setError("answer must be at least 8 characters"); return; }
                        await respond(p.id, { status: "resolved", resolution_text: resolveDraft });
                        setResolveOpenId(null); setResolveDraft("");
                      }}
                      style={{ background: "transparent", border: "1px solid #7affcb", color: "#7affcb", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "inherit" }}
                    >
                      resolve
                    </button>
                    <button onClick={() => { setResolveOpenId(null); setResolveDraft(""); }} style={{ background: "transparent", border: "1px solid #3a3530", color: "#5a544c", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>cancel</button>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {isOpen && (
                  <>
                    <button onClick={() => respond(p.id, { status: "named" })} style={{ background: "transparent", border: "1px solid #c9b3f4", color: "#c9b3f4", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>name it</button>
                    <button onClick={() => { setResolveOpenId(p.id); setResolveDraft(p.resolution_text ?? ""); }} style={{ background: "transparent", border: "1px solid #7affcb", color: "#7affcb", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>resolve</button>
                    <button onClick={() => respond(p.id, { status: "contested" })} style={{ background: "transparent", border: "1px solid #fbb86d", color: "#fbb86d", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>contest</button>
                    <button onClick={() => respond(p.id, { status: "dismissed" })} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>dismiss</button>
                    <button onClick={() => { setNoteOpenId(p.id); setNoteDraft(p.user_note ?? ""); }} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>+ note</button>
                  </>
                )}
                {!isOpen && p.user_status === "named" && (
                  <button onClick={() => { setResolveOpenId(p.id); setResolveDraft(p.resolution_text ?? ""); }} style={{ background: "transparent", border: "1px solid #7affcb", color: "#7affcb", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>resolve</button>
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
