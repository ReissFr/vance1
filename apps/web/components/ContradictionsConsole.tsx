"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const MINT = "#7affcb";
const SALMON = "#f4577a";
const AMBER = "#fbb86d";
const PEACH = "#f4a8a8";
const SAGE = "#9aa28e";
const LAVENDER = "#c9b3f4";
const BLUE = "#bfd4ee";
const TAUPE = "#bfb5a8";
const BONE = "#bfb5a8";

type Contradiction = {
  id: string;
  scan_id: string | null;
  statement_a: string;
  statement_a_date: string;
  statement_a_msg_id: string;
  statement_b: string;
  statement_b_date: string;
  statement_b_msg_id: string;
  topic: string;
  contradiction_kind: string;
  domain: string;
  charge: number;
  confidence: number;
  days_apart: number;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  open: number;
  evolved: number;
  dual: number;
  confused: number;
  rejected: number;
  dismissed: number;
  pinned: number;
  load_bearing_open: number;
  longest_unreconciled_days: number;
  avg_charge_open: number;
  by_status: Record<string, number>;
  by_kind: Record<string, number>;
  by_domain: Record<string, number>;
};

const KIND_COLOR: Record<string, string> = {
  preference: TAUPE,
  belief: BLUE,
  claim: SAGE,
  commitment: AMBER,
  identity: SALMON,
  value: LAVENDER,
  desire: PEACH,
  appraisal: MINT,
};

const KIND_LABEL: Record<string, string> = {
  preference: "PREFERENCE",
  belief: "BELIEF",
  claim: "CLAIM",
  commitment: "COMMITMENT",
  identity: "IDENTITY",
  value: "VALUE",
  desire: "DESIRE",
  appraisal: "APPRAISAL",
};

const STATUS_COLOR: Record<string, string> = {
  open: SALMON,
  evolved: MINT,
  dual: LAVENDER,
  confused: AMBER,
  rejected: SAGE,
  dismissed: TAUPE,
};

const STATUS_LABEL: Record<string, string> = {
  open: "OPEN",
  evolved: "EVOLVED",
  dual: "DUAL",
  confused: "CONFUSED",
  rejected: "REJECTED",
  dismissed: "DISMISSED",
};

const STATUS_BLURB: Record<string, string> = {
  evolved: "the later statement is now-true; the earlier was a past self",
  dual: "both statements hold in different contexts, moods, life-phases",
  confused: "you genuinely don't know which holds; the contradiction is alive",
  rejected: "neither is current; you've moved past both",
};

const KINDS = ["preference", "belief", "claim", "commitment", "identity", "value", "desire", "appraisal"];
const DOMAINS = ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"];

type ResolveMode = "evolved" | "dual" | "confused" | "rejected" | null;

function ymd(date: string): string {
  return date.slice(0, 10);
}

function formatDays(n: number): string {
  if (n < 30) return `${n}d`;
  if (n < 365) return `${Math.round(n / 30)}mo`;
  const yrs = (n / 365).toFixed(1);
  return `${yrs}y`;
}

export function ContradictionsConsole() {
  const [rows, setRows] = useState<Contradiction[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [windowDays, setWindowDays] = useState(180);

  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [minCharge, setMinCharge] = useState<number>(1);
  const [minDaysApart, setMinDaysApart] = useState<number>(0);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const [resolveTarget, setResolveTarget] = useState<Contradiction | null>(null);
  const [resolveMode, setResolveMode] = useState<ResolveMode>(null);
  const [resolveNote, setResolveNote] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (kindFilter) params.set("kind", kindFilter);
    if (domainFilter) params.set("domain", domainFilter);
    if (minCharge > 1) params.set("min_charge", String(minCharge));
    if (minDaysApart > 0) params.set("min_days_apart", String(minDaysApart));
    if (pinnedOnly) params.set("pinned", "true");
    if (showArchived) params.set("include_archived", "true");
    params.set("limit", "200");
    const r = await fetch(`/api/contradictions?${params.toString()}`);
    const j = await r.json();
    setRows(j.contradictions ?? []);
    setStats(j.stats ?? null);
    setLoading(false);
  }, [statusFilter, kindFilter, domainFilter, minCharge, minDaysApart, pinnedOnly, showArchived]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await fetch("/api/contradictions/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error || "scan failed");
      } else {
        const inserted = j.inserted ?? 0;
        const skipped = j.skipped ?? 0;
        if (inserted === 0 && skipped === 0) {
          alert(j.message || "no contradictions detected — try a wider window or come back after more chats");
        }
      }
    } finally {
      setScanning(false);
      fetchRows();
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/contradictions/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) { alert(j.error || "failed"); return false; }
    return true;
  };

  const submitResolve = async () => {
    if (!resolveTarget || !resolveMode) return;
    const note = resolveNote.trim();
    if (note.length < 4) { alert(`${resolveMode} needs a sentence — at least 4 characters`); return; }
    const ok = await patch(resolveTarget.id, { action: resolveMode, resolution_note: note });
    if (ok) {
      setResolveTarget(null);
      setResolveMode(null);
      setResolveNote("");
      fetchRows();
    }
  };

  const onPin = async (c: Contradiction) => { if (await patch(c.id, { action: c.pinned ? "unpin" : "pin" })) fetchRows(); };
  const onArchive = async (c: Contradiction) => { if (await patch(c.id, { action: c.archived_at ? "restore" : "archive" })) fetchRows(); };
  const onDismiss = async (c: Contradiction) => { if (await patch(c.id, { action: "dismiss" })) fetchRows(); };
  const onUnresolve = async (c: Contradiction) => { if (await patch(c.id, { action: "unresolve" })) fetchRows(); };
  const onDelete = async (c: Contradiction) => {
    if (!confirm("Delete this contradiction?")) return;
    const r = await fetch(`/api/contradictions/${c.id}`, { method: "DELETE" });
    if (r.ok) fetchRows();
  };

  const openResolve = (c: Contradiction, mode: ResolveMode) => {
    setResolveTarget(c);
    setResolveMode(mode);
    setResolveNote("");
  };

  const placeholder = useMemo(() => {
    if (resolveMode === "evolved") return "which is current now, and what changed?";
    if (resolveMode === "dual") return "in what contexts / moods / phases does each one hold?";
    if (resolveMode === "confused") return "what makes this hard to reconcile?";
    if (resolveMode === "rejected") return "what's your actual current stance? neither, or something else?";
    return "";
  }, [resolveMode]);

  return (
    <div style={{ padding: "16px 20px 80px", color: BONE, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${TAUPE}33` }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>cross-time pairs that don't fully agree</div>
          <div style={{ fontSize: 13, color: BONE, marginTop: 4, fontStyle: "italic", fontFamily: "Georgia, serif" }}>
            you said one thing, then another — sometimes that's growth, sometimes both hold, sometimes you don't know yet. name which.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>window</span>
          {[60, 90, 180, 365, 540].map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              style={{
                background: windowDays === d ? `${MINT}20` : "transparent",
                color: windowDays === d ? MINT : TAUPE,
                border: `1px solid ${windowDays === d ? MINT : TAUPE}55`,
                padding: "4px 8px",
                fontSize: 10,
                letterSpacing: "0.1em",
                cursor: "pointer",
                borderRadius: 2,
              }}
            >
              {d < 365 ? `${d}d` : d === 365 ? "1y" : "1.5y"}
            </button>
          ))}
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          style={{
            background: scanning ? `${MINT}10` : MINT,
            color: scanning ? MINT : "#0a0a0a",
            border: `1px solid ${MINT}`,
            padding: "8px 14px",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            cursor: scanning ? "wait" : "pointer",
            borderRadius: 2,
            fontWeight: 600,
          }}
        >
          {scanning ? "scanning..." : "Find contradictions"}
        </button>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="open" value={stats.open} sub={stats.load_bearing_open > 0 ? `${stats.load_bearing_open} load-bearing` : "unreconciled"} color={SALMON} />
          <StatCard label="longest unreconciled" value={stats.longest_unreconciled_days > 0 ? formatDays(stats.longest_unreconciled_days) : "—"} sub="days between the two statements" color={AMBER} />
          <StatCard label="dual" value={stats.dual} sub="both holding in different contexts" color={LAVENDER} />
          <StatCard label="evolved + rejected" value={stats.evolved + stats.rejected} sub="positions that have shifted" color={MINT} />
        </div>
      )}

      <FilterRow label="status">
        {["open", "evolved", "dual", "confused", "rejected", "dismissed", "all"].map((s) => (
          <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} color={STATUS_COLOR[s] || TAUPE}>{s}</Pill>
        ))}
        <Pill active={pinnedOnly} onClick={() => setPinnedOnly((v) => !v)} color={LAVENDER}>pinned</Pill>
        <Pill active={showArchived} onClick={() => setShowArchived((v) => !v)} color={TAUPE}>+ archived</Pill>
      </FilterRow>

      <FilterRow label="kind">
        <Pill active={kindFilter === ""} onClick={() => setKindFilter("")} color={BONE}>all</Pill>
        {KINDS.map((k) => (
          <Pill key={k} active={kindFilter === k} onClick={() => setKindFilter(k)} color={KIND_COLOR[k] || TAUPE}>{k}</Pill>
        ))}
      </FilterRow>

      <FilterRow label="domain">
        <Pill active={domainFilter === ""} onClick={() => setDomainFilter("")} color={BONE}>all</Pill>
        {DOMAINS.map((d) => (
          <Pill key={d} active={domainFilter === d} onClick={() => setDomainFilter(d)} color={BLUE}>{d}</Pill>
        ))}
      </FilterRow>

      <FilterRow label="charge">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pill key={n} active={minCharge === n} onClick={() => setMinCharge(n)} color={SALMON}>{n === 1 ? "any" : `${n}+`}</Pill>
        ))}
      </FilterRow>

      <FilterRow label="apart">
        {[
          [0, "any"],
          [30, "30d+"],
          [90, "90d+"],
          [180, "180d+"],
          [365, "1y+"],
        ].map(([n, lbl]) => (
          <Pill key={String(n)} active={minDaysApart === n} onClick={() => setMinDaysApart(n as number)} color={AMBER}>{lbl as string}</Pill>
        ))}
      </FilterRow>

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>loading...</div>
        ) : rows.length === 0 ? (
          <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>
            no contradictions in this view. press FIND CONTRADICTIONS — the scan reads pairs across the window. (it needs at least a few weeks of substantive chats to find anything.)
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((c) => <Card key={c.id} c={c} onResolve={(m) => openResolve(c, m)} onPin={() => onPin(c)} onArchive={() => onArchive(c)} onDismiss={() => onDismiss(c)} onUnresolve={() => onUnresolve(c)} onDelete={() => onDelete(c)} />)}
          </div>
        )}
      </div>

      {resolveTarget && resolveMode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { setResolveTarget(null); setResolveMode(null); setResolveNote(""); }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "100%", background: "#0a0a0a", border: `2px solid ${STATUS_COLOR[resolveMode]}`, padding: 24, borderRadius: 4 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: STATUS_COLOR[resolveMode], marginBottom: 6 }}>{STATUS_LABEL[resolveMode]}</div>
            <div style={{ fontSize: 13, fontStyle: "italic", color: BONE, marginBottom: 14, fontFamily: "Georgia, serif" }}>{STATUS_BLURB[resolveMode]}</div>
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 8 }}>topic — <span style={{ color: BONE, fontStyle: "italic" }}>{resolveTarget.topic}</span></div>
            <div style={{ fontSize: 13, color: BONE, marginBottom: 6 }}><span style={{ color: TAUPE }}>{ymd(resolveTarget.statement_a_date)} —</span> <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>{resolveTarget.statement_a}</span></div>
            <div style={{ fontSize: 13, color: BONE, marginBottom: 14 }}><span style={{ color: TAUPE }}>{ymd(resolveTarget.statement_b_date)} —</span> <span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>{resolveTarget.statement_b}</span></div>
            <textarea
              autoFocus
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder={placeholder}
              style={{ width: "100%", minHeight: 80, background: "#000", color: BONE, border: `1px solid ${TAUPE}55`, padding: 10, fontFamily: "Georgia, serif", fontSize: 14, fontStyle: "italic", borderRadius: 2, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button onClick={() => { setResolveTarget(null); setResolveMode(null); setResolveNote(""); }} style={{ background: "transparent", color: TAUPE, border: `1px solid ${TAUPE}55`, padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>cancel</button>
              <button onClick={submitResolve} style={{ background: STATUS_COLOR[resolveMode], color: "#0a0a0a", border: `1px solid ${STATUS_COLOR[resolveMode]}`, padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600 }}>confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color: string }) {
  return (
    <div style={{ background: `${color}10`, border: `1px solid ${color}55`, padding: 12, borderRadius: 2 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", color, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 28, color: BONE, fontWeight: 300, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: TAUPE, marginTop: 2, fontStyle: "italic" }}>{sub}</div>}
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase", minWidth: 64 }}>{label}</span>
      {children}
    </div>
  );
}

function Pill({ active, onClick, color, children }: { active: boolean; onClick: () => void; color: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? `${color}20` : "transparent",
        color: active ? color : TAUPE,
        border: `1px solid ${active ? color : TAUPE}55`,
        padding: "4px 9px",
        fontSize: 10,
        letterSpacing: "0.1em",
        cursor: "pointer",
        borderRadius: 2,
        textTransform: "lowercase",
      }}
    >
      {children}
    </button>
  );
}

function ChargeMeter({ value }: { value: number }) {
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} style={{ width: 5, height: 5, borderRadius: 5, background: n <= value ? SALMON : `${TAUPE}33` }} />
      ))}
    </div>
  );
}

function Card({ c, onResolve, onPin, onArchive, onDismiss, onUnresolve, onDelete }: {
  c: Contradiction;
  onResolve: (mode: ResolveMode) => void;
  onPin: () => void;
  onArchive: () => void;
  onDismiss: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
}) {
  const isOpen = c.status === "open";
  const isResolved = ["evolved", "dual", "confused", "rejected"].includes(c.status);
  const accent = isOpen ? KIND_COLOR[c.contradiction_kind] || TAUPE : STATUS_COLOR[c.status] || TAUPE;
  const archived = !!c.archived_at;
  return (
    <div style={{ borderLeft: `3px solid ${accent}`, background: archived ? "#0a0a0a55" : "#0a0a0a", padding: "14px 16px", borderRadius: "0 2px 2px 0", opacity: archived ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.18em", color: KIND_COLOR[c.contradiction_kind] || TAUPE, textTransform: "uppercase" }}>{KIND_LABEL[c.contradiction_kind] || c.contradiction_kind}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em" }}>{c.domain}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: AMBER, letterSpacing: "0.1em" }}>{formatDays(c.days_apart)} apart</span>
        {c.pinned && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, color: LAVENDER }}>● pinned</span></>)}
        {!isOpen && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, padding: "1px 6px", border: `1px solid ${STATUS_COLOR[c.status] || TAUPE}55`, color: STATUS_COLOR[c.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", borderRadius: 2 }}>{STATUS_LABEL[c.status] || c.status}</span></>)}
        <div style={{ marginLeft: "auto" }}><ChargeMeter value={c.charge} /></div>
      </div>

      <div style={{ fontSize: 16, fontFamily: "Georgia, serif", fontStyle: "italic", color: BONE, marginBottom: 12, lineHeight: 1.45 }}>
        the territory — <span style={{ color: accent }}>&ldquo;{c.topic}&rdquo;</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        <div style={{ background: `${accent}08`, borderLeft: `2px solid ${accent}55`, padding: "8px 12px", borderRadius: 2 }}>
          <div style={{ fontSize: 10, color: TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>{ymd(c.statement_a_date)} — earlier</div>
          <div style={{ fontSize: 14, color: BONE, fontFamily: "Georgia, serif", fontStyle: "italic", lineHeight: 1.45 }}>&ldquo;{c.statement_a}&rdquo;</div>
        </div>
        <div style={{ background: `${accent}08`, borderLeft: `2px solid ${accent}55`, padding: "8px 12px", borderRadius: 2 }}>
          <div style={{ fontSize: 10, color: TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>{ymd(c.statement_b_date)} — later</div>
          <div style={{ fontSize: 14, color: BONE, fontFamily: "Georgia, serif", fontStyle: "italic", lineHeight: 1.45 }}>&ldquo;{c.statement_b}&rdquo;</div>
        </div>
      </div>

      {c.resolution_note && isResolved && (
        <div style={{ background: `${STATUS_COLOR[c.status] || TAUPE}10`, border: `1px solid ${STATUS_COLOR[c.status] || TAUPE}55`, padding: "8px 12px", marginBottom: 12, borderRadius: 2 }}>
          <div style={{ fontSize: 10, color: STATUS_COLOR[c.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>{STATUS_LABEL[c.status]} — your reckoning</div>
          <div style={{ fontSize: 13, color: BONE, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>{c.resolution_note}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {isOpen ? (
          <>
            <ActionButton color={MINT} onClick={() => onResolve("evolved")}>evolved</ActionButton>
            <ActionButton color={LAVENDER} onClick={() => onResolve("dual")}>dual</ActionButton>
            <ActionButton color={AMBER} onClick={() => onResolve("confused")}>confused</ActionButton>
            <ActionButton color={SAGE} onClick={() => onResolve("rejected")}>rejected</ActionButton>
            <ActionButton color={TAUPE} onClick={onDismiss}>dismiss</ActionButton>
          </>
        ) : isResolved ? (
          <ActionButton color={TAUPE} onClick={onUnresolve}>unresolve</ActionButton>
        ) : null}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <ActionButton color={LAVENDER} onClick={onPin}>{c.pinned ? "unpin" : "pin"}</ActionButton>
          <ActionButton color={TAUPE} onClick={onArchive}>{archived ? "restore" : "archive"}</ActionButton>
          <ActionButton color={SALMON} onClick={onDelete}>delete</ActionButton>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        color,
        border: `1px solid ${color}55`,
        padding: "5px 10px",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        cursor: "pointer",
        borderRadius: 2,
      }}
    >
      {children}
    </button>
  );
}
