"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Promise = {
  id: string;
  scan_id: string;
  action_summary: string;
  original_quote: string;
  category: string;
  deadline_text: string | null;
  deadline_date: string | null;
  promised_at: string;
  source_conversation_id: string | null;
  source_message_id: string | null;
  strength: number;
  repeat_count: number;
  prior_promise_id: string | null;
  status: "pending" | "kept" | "broken" | "deferred" | "cancelled" | "unclear";
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
  overdue: number;
  kept: number;
  broken: number;
  deferred: number;
  cancelled: number;
  unclear: number;
  resolved: number;
  repromised: number;
  self_trust_rate: number | null;
};

type Status = "pending" | "overdue" | "due" | "kept" | "broken" | "deferred" | "cancelled" | "unclear" | "resolved" | "pinned" | "archived" | "all";

const CATEGORY_TINT: Record<string, string> = {
  habit: "#7affcb",
  decision: "#fbb86d",
  relationship: "#f4c9d8",
  health: "#7affcb",
  work: "#bfd4ee",
  creative: "#c9b3f4",
  financial: "#9aa28e",
  identity: "#c9b3f4",
  other: "#e8e0d2",
};

const CATEGORIES = ["habit", "decision", "relationship", "health", "work", "creative", "financial", "identity", "other"];

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

function deadlineState(deadlineDate: string | null, status: string): { label: string; color: string } | null {
  if (!deadlineDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (status !== "pending") {
    return { label: deadlineDate, color: "#5a544c" };
  }
  if (deadlineDate < today) {
    const daysOver = Math.round((Date.now() - new Date(deadlineDate + "T00:00:00.000Z").getTime()) / 86_400_000);
    return { label: `${deadlineDate} · overdue ${daysOver}d`, color: "#f4c9d8" };
  }
  if (deadlineDate === today) return { label: `due today`, color: "#fbb86d" };
  const daysUntil = Math.round((new Date(deadlineDate + "T00:00:00.000Z").getTime() - Date.now()) / 86_400_000);
  return { label: `${deadlineDate} · in ${daysUntil}d`, color: "#7affcb" };
}

const STATUS_COLOR: Record<string, string> = {
  kept: "#7affcb",
  broken: "#f4c9d8",
  deferred: "#fbb86d",
  cancelled: "#9aa28e",
  unclear: "#bfd4ee",
};

export function PromisesConsole() {
  const [rows, setRows] = useState<Promise[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState<Status>("pending");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<{ inserted: number; signals?: Record<string, number>; latency_ms?: number } | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeWindow, setComposeWindow] = useState(120);

  const [noteOpenId, setNoteOpenId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [resolveOpenId, setResolveOpenId] = useState<string | null>(null);
  const [resolveStatus, setResolveStatus] = useState<"kept" | "broken" | "deferred" | "cancelled" | "unclear">("kept");
  const [resolveNote, setResolveNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("limit", "100");
      if (categoryFilter) params.set("category", categoryFilter);
      const r = await fetch(`/api/promises?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { promises: Promise[]; stats: Stats };
      setRows(j.promises);
      setStats(j.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, categoryFilter]);

  useEffect(() => { void load(); }, [load]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setScanResult(null);
    try {
      const body: Record<string, unknown> = { window_days: composeWindow };
      const r = await fetch(`/api/promises/scan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) {
        const errBody = await r.text();
        throw new Error(`HTTP ${r.status}: ${errBody.slice(0, 200)}`);
      }
      const j = (await r.json()) as { inserted: number; signals?: Record<string, number>; latency_ms?: number };
      setScanResult({ inserted: j.inserted, signals: j.signals, latency_ms: j.latency_ms });
      setComposeOpen(false);
      setStatus("pending");
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
      const r = await fetch(`/api/promises/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
    if (!confirm("Delete this promise from the ledger? Cannot be undone.")) return;
    setError(null);
    try {
      const r = await fetch(`/api/promises/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const trustRateLabel = useMemo(() => {
    if (!stats || stats.self_trust_rate == null) return "—";
    return `${stats.self_trust_rate}%`;
  }, [stats]);

  const trustColor = useMemo(() => {
    if (!stats || stats.self_trust_rate == null) return "#9aa28e";
    if (stats.self_trust_rate >= 70) return "#7affcb";
    if (stats.self_trust_rate >= 40) return "#fbb86d";
    return "#f4c9d8";
  }, [stats]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 18, color: "#f0e6d2", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
        <button
          onClick={() => setComposeOpen(true)}
          disabled={scanning}
          style={{ flex: "1 1 360px", background: "transparent", border: "1px solid #fbb86d", color: "#fbb86d", padding: "12px 16px", borderRadius: 4, cursor: "pointer", fontWeight: 600, letterSpacing: 1, textAlign: "left", fontFamily: "inherit" }}
        >
          <div style={{ fontSize: 13, opacity: 0.95, textTransform: "uppercase" }}>{scanning ? "scanning your messages..." : "scan for self-promises"}</div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4, fontWeight: 400, letterSpacing: 0 }}>mine your own messages for every &quot;I will&quot;, &quot;starting Monday I&apos;ll&quot;, &quot;next week I&apos;m going to&quot; — every commitment you&apos;ve made to yourself</div>
        </button>
      </div>

      {scanResult && (
        <div style={{ background: "#1f2418", border: "1px solid #7affcb", color: "#7affcb", padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>
          {scanResult.inserted} new promise{scanResult.inserted === 1 ? "" : "s"} added to ledger
          {scanResult.latency_ms ? ` · ${(scanResult.latency_ms / 1000).toFixed(1)}s` : ""}
          {scanResult.signals ? ` · scanned: ${Object.entries(scanResult.signals).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}
        </div>
      )}
      {error && <div style={{ background: "#2a1a1a", border: "1px solid #f4c9d8", color: "#f4c9d8", padding: "8px 12px", borderRadius: 4, fontSize: 12 }}>{error}</div>}

      {/* Stats panel */}
      {stats && stats.total > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8, background: "#13110f", border: "1px solid #2a2620", borderRadius: 4, padding: 14 }}>
          <Stat label="self-trust rate" value={trustRateLabel} color={trustColor} sub={stats.kept + stats.broken > 0 ? `${stats.kept} of ${stats.kept + stats.broken}` : "no decided yet"} large />
          <Stat label="pending" value={`${stats.pending}`} color="#bfd4ee" />
          <Stat label="overdue" value={`${stats.overdue}`} color={stats.overdue > 0 ? "#f4c9d8" : "#5a544c"} />
          <Stat label="kept" value={`${stats.kept}`} color="#7affcb" />
          <Stat label="broken" value={`${stats.broken}`} color="#f4c9d8" />
          <Stat label="deferred" value={`${stats.deferred}`} color="#fbb86d" />
          <Stat label="re-promised" value={`${stats.repromised}`} color="#c9b3f4" sub="said again" />
          <Stat label="total" value={`${stats.total}`} color="#9aa28e" />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {(["pending", "overdue", "due", "kept", "broken", "deferred", "cancelled", "unclear", "resolved", "pinned", "archived", "all"] as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{ background: status === s ? "#fbb86d" : "transparent", color: status === s ? "#1a1614" : "#9aa28e", border: `1px solid ${status === s ? "#fbb86d" : "#3a3530"}`, padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}
          >
            {s}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: "#3a3530", margin: "0 6px" }} />
        <span style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5 }}>category:</span>
        <button
          onClick={() => setCategoryFilter(null)}
          style={{ background: categoryFilter == null ? "#3a3530" : "transparent", color: categoryFilter == null ? "#f0e6d2" : "#5a544c", border: "1px solid #3a3530", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}
        >
          all
        </button>
        {CATEGORIES.map((d) => (
          <button
            key={d}
            onClick={() => setCategoryFilter(d)}
            style={{ background: categoryFilter === d ? CATEGORY_TINT[d] : "transparent", color: categoryFilter === d ? "#1a1614" : "#5a544c", border: `1px solid ${categoryFilter === d ? CATEGORY_TINT[d] : "#3a3530"}`, padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}
          >
            {d}
          </button>
        ))}
      </div>

      {composeOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }} onClick={() => setComposeOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#13110f", border: "1px solid #3a3530", borderRadius: 4, padding: 22, width: "min(560px, 92vw)", color: "#f0e6d2", fontFamily: "inherit" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#fbb86d", letterSpacing: 1, marginBottom: 4 }}>SCAN FOR SELF-PROMISES</div>
            <div style={{ fontSize: 12, color: "#9aa28e", marginBottom: 16, lineHeight: 1.5 }}>
              reads your own messages over the window, finds every &quot;I will&quot; / &quot;starting Monday I&apos;ll&quot; / &quot;next week I&apos;m going to&quot; / &quot;I need to&quot;, distills the action, attaches the deadline if you specified one, and adds them to the ledger. takes 8-15 seconds. only adds promises that aren&apos;t already in the ledger.
            </div>

            <label style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5 }}>window (days back)</label>
            <input
              type="number"
              min={14}
              max={365}
              value={composeWindow}
              onChange={(e) => setComposeWindow(Math.max(14, Math.min(365, parseInt(e.target.value, 10) || 120)))}
              style={{ width: "100%", background: "#0d0c0a", border: "1px solid #3a3530", color: "#f0e6d2", padding: "8px 10px", borderRadius: 4, fontFamily: "inherit", fontSize: 13, marginTop: 4, marginBottom: 6 }}
            />
            <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
              {[30, 60, 90, 120, 180, 365].map((n) => (
                <button key={n} type="button" onClick={() => setComposeWindow(n)} style={{ background: composeWindow === n ? "#3a3530" : "transparent", color: "#9aa28e", border: "1px solid #3a3530", padding: "3px 7px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>
                  {n}d
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setComposeOpen(false)} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "8px 14px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>cancel</button>
              <button onClick={runScan} disabled={scanning} style={{ background: "transparent", border: "1px solid #fbb86d", color: "#fbb86d", padding: "8px 14px", borderRadius: 4, cursor: scanning ? "wait" : "pointer", fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "inherit" }}>{scanning ? "scanning..." : "scan"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {loading && <div style={{ color: "#9aa28e", fontSize: 12 }}>loading...</div>}
        {!loading && rows.length === 0 && (
          <div style={{ color: "#5a544c", fontSize: 12, fontStyle: "italic", padding: 24, textAlign: "center" }}>
            no promises in this view. {status === "pending" ? "scan to mine your messages, or your ledger is genuinely empty." : "try a different filter."}
          </div>
        )}
        {rows.map((p) => {
          const tint = CATEGORY_TINT[p.category] ?? "#9aa28e";
          const dl = deadlineState(p.deadline_date, p.status);
          const isPending = p.status === "pending" && !p.archived_at;
          return (
            <div key={p.id} style={{ background: "#13110f", border: "1px solid #2a2620", borderLeft: `3px solid ${p.repeat_count > 0 ? "#c9b3f4" : tint}`, borderRadius: 4, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ color: tint, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600 }}>{p.category}</span>
                {dotMeter(p.strength, tint)}
                {p.repeat_count > 0 && (
                  <span style={{ background: "#1f1a24", color: "#c9b3f4", border: "1px solid #c9b3f4", padding: "2px 7px", borderRadius: 10, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    re-promised {p.repeat_count}×
                  </span>
                )}
                {dl && (
                  <span style={{ color: dl.color, fontSize: 11 }}>{dl.label}</span>
                )}
                {p.status !== "pending" && (
                  <span style={{
                    background: "#0d0c0a",
                    color: STATUS_COLOR[p.status] ?? "#9aa28e",
                    border: `1px solid ${STATUS_COLOR[p.status] ?? "#3a3530"}`,
                    padding: "2px 7px", borderRadius: 10, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5,
                  }}>
                    {p.status} {relTime(p.resolved_at)}
                  </span>
                )}
                {p.pinned && <span style={{ color: "#fbb86d", fontSize: 11 }}>★</span>}
                <span style={{ marginLeft: "auto", color: "#5a544c", fontSize: 10 }}>promised {p.promised_at}</span>
              </div>

              <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 16, color: "#f0e6d2", marginBottom: 8, lineHeight: 1.4 }}>
                {p.action_summary}
              </div>

              <div style={{ background: "#0d0c0a", borderLeft: `2px solid ${tint}`, padding: "8px 12px", marginBottom: 10, fontFamily: "Georgia, serif", fontSize: 13, fontStyle: "italic", color: "#c9c1ad", lineHeight: 1.5 }}>
                &quot;{p.original_quote}&quot;
              </div>

              {p.status_note && (
                <div style={{ marginBottom: 10, padding: "8px 12px", background: "#0d0c0a", borderLeft: `2px solid ${STATUS_COLOR[p.status] ?? tint}`, color: "#9aa28e", fontSize: 12, lineHeight: 1.5 }}>
                  {p.status_note}
                </div>
              )}

              {noteOpenId === p.id && (
                <div style={{ marginBottom: 10 }}>
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="add a note..."
                    rows={2}
                    style={{ width: "100%", background: "#0d0c0a", border: "1px solid #3a3530", color: "#f0e6d2", padding: 8, borderRadius: 4, fontFamily: "inherit", fontSize: 12, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button onClick={async () => { await respond(p.id, { status_note: noteDraft }); setNoteOpenId(null); setNoteDraft(""); }} style={{ background: "transparent", border: "1px solid #7affcb", color: "#7affcb", padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>save</button>
                    <button onClick={() => { setNoteOpenId(null); setNoteDraft(""); }} style={{ background: "transparent", border: "1px solid #3a3530", color: "#5a544c", padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>cancel</button>
                  </div>
                </div>
              )}

              {resolveOpenId === p.id && (
                <div style={{ marginBottom: 10, background: "#0d0c0a", border: `1px solid ${STATUS_COLOR[resolveStatus] ?? "#3a3530"}`, borderRadius: 4, padding: 12 }}>
                  <div style={{ fontSize: 10, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>how did this play out?</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {(["kept", "broken", "deferred", "cancelled", "unclear"] as const).map((s) => (
                      <button key={s} type="button" onClick={() => setResolveStatus(s)} style={{ background: resolveStatus === s ? STATUS_COLOR[s] : "transparent", color: resolveStatus === s ? "#1a1614" : STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`, padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600, fontFamily: "inherit" }}>{s}</button>
                    ))}
                  </div>
                  <textarea
                    value={resolveNote}
                    onChange={(e) => setResolveNote(e.target.value)}
                    placeholder="optional note (what actually happened)..."
                    rows={2}
                    style={{ width: "100%", background: "#0d0c0a", border: "1px solid #3a3530", color: "#f0e6d2", padding: 8, borderRadius: 4, fontFamily: "inherit", fontSize: 12, resize: "vertical" }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button
                      onClick={async () => {
                        const body: Record<string, unknown> = { status: resolveStatus };
                        if (resolveNote.trim()) body.status_note = resolveNote.trim();
                        await respond(p.id, body);
                        setResolveOpenId(null); setResolveNote("");
                      }}
                      style={{ background: "transparent", border: "1px solid #7affcb", color: "#7affcb", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", fontFamily: "inherit" }}
                    >
                      save
                    </button>
                    <button onClick={() => { setResolveOpenId(null); setResolveNote(""); }} style={{ background: "transparent", border: "1px solid #3a3530", color: "#5a544c", padding: "5px 12px", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>cancel</button>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {isPending && (
                  <>
                    <button onClick={() => { setResolveOpenId(p.id); setResolveStatus("kept"); setResolveNote(p.status_note ?? ""); }} style={{ background: "transparent", border: "1px solid #7affcb", color: "#7affcb", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>kept</button>
                    <button onClick={() => { setResolveOpenId(p.id); setResolveStatus("broken"); setResolveNote(p.status_note ?? ""); }} style={{ background: "transparent", border: "1px solid #f4c9d8", color: "#f4c9d8", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>broken</button>
                    <button onClick={() => { setResolveOpenId(p.id); setResolveStatus("deferred"); setResolveNote(p.status_note ?? ""); }} style={{ background: "transparent", border: "1px solid #fbb86d", color: "#fbb86d", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>defer</button>
                    <button onClick={() => { setResolveOpenId(p.id); setResolveStatus("cancelled"); setResolveNote(p.status_note ?? ""); }} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>cancel</button>
                    <button onClick={() => { setResolveOpenId(p.id); setResolveStatus("unclear"); setResolveNote(p.status_note ?? ""); }} style={{ background: "transparent", border: "1px solid #bfd4ee", color: "#bfd4ee", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>unclear</button>
                    <button onClick={() => { setNoteOpenId(p.id); setNoteDraft(p.status_note ?? ""); }} style={{ background: "transparent", border: "1px solid #3a3530", color: "#9aa28e", padding: "5px 10px", borderRadius: 3, cursor: "pointer", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, fontFamily: "inherit" }}>+ note</button>
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

function Stat({ label, value, color, sub, large }: { label: string; value: string; color: string; sub?: string; large?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: "#5a544c", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: large ? 28 : 20, color, fontWeight: 600, lineHeight: 1.1, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "#5a544c", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
