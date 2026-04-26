"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type PreWrite = {
  id: string;
  kind: "reflection" | "standup" | "intention" | "win" | "checkin";
  subkind: string | null;
  draft_body: Record<string, unknown>;
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  status: "shown" | "accepted" | "edited" | "rejected" | "superseded";
  accepted_id: string | null;
  user_score: number | null;
  user_note: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
  resolved_at: string | null;
};

type AcceptanceByKind = Record<string, { shown: number; accepted: number; edited: number; rejected: number }>;

type Status = "all" | "shown" | "accepted" | "edited" | "rejected" | "superseded";
type Kind = "all" | "reflection" | "standup" | "intention" | "win" | "checkin";

const KIND_COLOR: Record<Exclude<Kind, "all">, string> = {
  reflection: "#bfd4ee",
  standup: "#fbb86d",
  intention: "#7affcb",
  win: "#f4c9d8",
  checkin: "#9aa28e",
};

const STATUS_COLOR: Record<PreWrite["status"], string> = {
  shown: "#bfd4ee",
  accepted: "#7affcb",
  edited: "#fbb86d",
  rejected: "#ff6b6b",
  superseded: "#5c5a52",
};

const STATUS_LABEL: Record<PreWrite["status"], string> = {
  shown: "Awaiting",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
  superseded: "Superseded",
};

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function renderDraft(kind: PreWrite["kind"], body: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const get = (k: string): string => {
    const v = body[k];
    if (v == null) return "";
    if (typeof v === "number") return String(v);
    if (typeof v === "string") return v;
    return JSON.stringify(v);
  };
  if (kind === "reflection") {
    if (body.kind) rows.push({ label: "kind", value: get("kind") });
    rows.push({ label: "text", value: get("text") });
  } else if (kind === "standup") {
    rows.push({ label: "yesterday", value: get("yesterday") });
    rows.push({ label: "today", value: get("today") });
    if (get("blockers")) rows.push({ label: "blockers", value: get("blockers") });
  } else if (kind === "intention") {
    rows.push({ label: "intention", value: get("text") });
  } else if (kind === "win") {
    if (body.kind) rows.push({ label: "kind", value: get("kind") });
    rows.push({ label: "text", value: get("text") });
  } else if (kind === "checkin") {
    rows.push({ label: "energy", value: get("energy") });
    rows.push({ label: "mood", value: get("mood") });
    rows.push({ label: "focus", value: get("focus") });
    if (get("note")) rows.push({ label: "note", value: get("note") });
  }
  return rows.filter((r) => r.value !== "");
}

export function PreWriteConsole() {
  const [rows, setRows] = useState<PreWrite[]>([]);
  const [acceptance, setAcceptance] = useState<AcceptanceByKind>({});
  const [status, setStatus] = useState<Status>("all");
  const [kind, setKind] = useState<Kind>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [generating, setGenerating] = useState<Kind | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("status", status);
      params.set("kind", kind);
      params.set("limit", "60");
      const r = await fetch(`/api/pre-write?${params.toString()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { pre_writes: PreWrite[]; acceptance_by_kind: AcceptanceByKind };
      setRows(j.pre_writes ?? []);
      setAcceptance(j.acceptance_by_kind ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [status, kind]);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (k: Exclude<Kind, "all">) => {
    setGenerating(k);
    setError(null);
    try {
      const r = await fetch("/api/pre-write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: k }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(null);
    }
  }, [load]);

  const resolve = useCallback(async (id: string, newStatus: "accepted" | "edited" | "rejected") => {
    setResolvingId(id);
    setError(null);
    try {
      const r = await fetch(`/api/pre-write/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResolvingId(null);
    }
  }, [load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm("Delete this draft permanently?")) return;
    setResolvingId(id);
    try {
      await fetch(`/api/pre-write/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setResolvingId(null);
    }
  }, [load]);

  const totals = useMemo(() => {
    let shown = 0; let accepted = 0; let edited = 0; let rejected = 0;
    for (const k of Object.keys(acceptance)) {
      const a = acceptance[k];
      if (!a) continue;
      shown += a.shown; accepted += a.accepted; edited += a.edited; rejected += a.rejected;
    }
    const total = shown + accepted + edited + rejected;
    const useful = accepted + edited;
    const acceptanceRate = total > 0 ? Math.round((useful / total) * 100) : null;
    return { shown, accepted, edited, rejected, total, useful, acceptanceRate };
  }, [acceptance]);

  const KINDS: Exclude<Kind, "all">[] = ["reflection", "standup", "intention", "win", "checkin"];
  const STATUSES: { value: Status; label: string }[] = [
    { value: "all", label: "all" },
    { value: "shown", label: "awaiting" },
    { value: "accepted", label: "accepted" },
    { value: "edited", label: "edited" },
    { value: "rejected", label: "rejected" },
    { value: "superseded", label: "superseded" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", color: "#e8e0d2" }}>
      <div style={{ background: "#1a1813", border: "1px solid #2a2620", borderRadius: 6, padding: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 11, color: "#9aa28e", letterSpacing: 1 }}>DRAFT A NEW PRE-WRITE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => generate(k)}
                disabled={generating !== null}
                style={{
                  padding: "8px 14px",
                  background: generating === k ? "#3a3530" : "#0e0c08",
                  color: KIND_COLOR[k],
                  border: `1px solid ${KIND_COLOR[k]}`,
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: "inherit",
                  cursor: generating !== null ? "wait" : "pointer",
                  opacity: generating !== null && generating !== k ? 0.4 : 1,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {generating === k ? "…drafting" : k}
              </button>
            ))}
          </div>
        </div>
      </div>

      {totals.total > 0 && (
        <div style={{ background: "#1a1813", border: "1px solid #2a2620", borderRadius: 6, padding: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap" }}>
              <div style={{ fontSize: 11, color: "#9aa28e", letterSpacing: 1 }}>ACCEPTANCE</div>
              {totals.acceptanceRate != null && (
                <div style={{ fontSize: 22, color: "#7affcb" }}>
                  {totals.acceptanceRate}%
                  <span style={{ fontSize: 11, color: "#9aa28e", marginLeft: 6 }}>
                    ({totals.useful}/{totals.total} useful)
                  </span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {KINDS.map((k) => {
                const a = acceptance[k];
                if (!a) return null;
                const total = a.shown + a.accepted + a.edited + a.rejected;
                if (total === 0) return null;
                const useful = a.accepted + a.edited;
                const rate = total > 0 ? Math.round((useful / total) * 100) : 0;
                return (
                  <div key={k} style={{ background: "#0e0c08", border: "1px solid #2a2620", borderRadius: 4, padding: "8px 12px", minWidth: 110 }}>
                    <div style={{ fontSize: 10, color: KIND_COLOR[k], textTransform: "uppercase", letterSpacing: 1 }}>{k}</div>
                    <div style={{ fontSize: 16, color: "#e8e0d2" }}>{rate}%</div>
                    <div style={{ fontSize: 10, color: "#9aa28e" }}>
                      {useful}/{total} · ✓{a.accepted} ✎{a.edited} ✗{a.rejected}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
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
        <span style={{ fontSize: 11, color: "#9aa28e", letterSpacing: 1, marginLeft: 12 }}>KIND</span>
        {(["all", ...KINDS] as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            style={{
              padding: "4px 10px",
              background: kind === k ? "#2a2620" : "transparent",
              color: kind === k ? "#e8e0d2" : "#9aa28e",
              border: `1px solid ${kind === k ? "#5c5a52" : "#2a2620"}`,
              borderRadius: 3,
              fontSize: 11,
              fontFamily: "inherit",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {k}
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
          No drafts yet. Pick a kind above to draft your first one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => {
            const draftRows = renderDraft(row.kind, row.draft_body);
            const kc = KIND_COLOR[row.kind];
            const sc = STATUS_COLOR[row.status];
            const open = row.status === "shown";
            return (
              <div
                key={row.id}
                style={{
                  background: "#1a1813",
                  border: "1px solid #2a2620",
                  borderLeft: `3px solid ${sc}`,
                  borderRadius: 6,
                  padding: 12,
                  opacity: row.status === "superseded" ? 0.55 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: kc, textTransform: "uppercase", letterSpacing: 1 }}>{row.kind}</span>
                    {row.subkind && <span style={{ fontSize: 11, color: "#9aa28e" }}>· {row.subkind}</span>}
                    <span style={{ fontSize: 10, color: sc, padding: "2px 6px", border: `1px solid ${sc}`, borderRadius: 3, textTransform: "uppercase", letterSpacing: 1 }}>
                      {STATUS_LABEL[row.status]}
                    </span>
                    <span style={{ fontSize: 10, color: "#5c5a52" }}>{relTime(row.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#5c5a52" }}>
                    {row.latency_ms != null && `${(row.latency_ms / 1000).toFixed(1)}s`}
                    {row.model && ` · ${row.model.includes("haiku") ? "haiku" : "sonnet"}`}
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: open ? 12 : 0 }}>
                  {draftRows.map((d) => (
                    <div key={d.label} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span style={{ fontSize: 10, color: "#5c5a52", minWidth: 70, textTransform: "uppercase", letterSpacing: 1 }}>{d.label}</span>
                      <span style={{ fontSize: 13, color: "#e8e0d2", whiteSpace: "pre-wrap", flex: 1 }}>{d.value}</span>
                    </div>
                  ))}
                </div>

                {row.source_summary && (
                  <div style={{ fontSize: 10, color: "#5c5a52", marginTop: 8, fontStyle: "italic" }}>
                    {row.source_summary}
                  </div>
                )}

                {row.user_note && (
                  <div style={{ fontSize: 11, color: "#9aa28e", marginTop: 6 }}>
                    note: {row.user_note}
                  </div>
                )}

                {open && (
                  <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                    <button
                      onClick={() => resolve(row.id, "accepted")}
                      disabled={resolvingId === row.id}
                      style={{ padding: "6px 12px", background: "#0e0c08", color: "#7affcb", border: "1px solid #7affcb", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => resolve(row.id, "edited")}
                      disabled={resolvingId === row.id}
                      style={{ padding: "6px 12px", background: "#0e0c08", color: "#fbb86d", border: "1px solid #fbb86d", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
                    >
                      Edited
                    </button>
                    <button
                      onClick={() => resolve(row.id, "rejected")}
                      disabled={resolvingId === row.id}
                      style={{ padding: "6px 12px", background: "#0e0c08", color: "#ff6b6b", border: "1px solid #ff6b6b", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1 }}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => remove(row.id)}
                      disabled={resolvingId === row.id}
                      style={{ padding: "6px 12px", background: "transparent", color: "#5c5a52", border: "1px solid #2a2620", borderRadius: 3, fontSize: 11, fontFamily: "inherit", cursor: "pointer", textTransform: "uppercase", letterSpacing: 1, marginLeft: "auto" }}
                    >
                      Delete
                    </button>
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
