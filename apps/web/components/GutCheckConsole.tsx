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

type GutCheck = {
  id: string;
  scan_id: string | null;
  gut_text: string;
  signal_kind: string;
  subject_text: string | null;
  domain: string;
  charge: number;
  recency: string;
  spoken_date: string;
  spoken_message_id: string;
  conversation_id: string | null;
  confidence: number;
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
  verified_right: number;
  verified_wrong: number;
  ignored_regret: number;
  ignored_relief: number;
  unresolved: number;
  dismissed: number;
  pinned: number;
  load_bearing_open: number;
  gut_accuracy_rate: number;
  gut_trust_rate: number;
  quadrant: {
    verified_right: number;
    verified_wrong: number;
    ignored_regret: number;
    ignored_relief: number;
  };
  per_signal_rate: Record<string, { right: number; total: number; rate: number }>;
  per_domain_rate: Record<string, { right: number; total: number; rate: number }>;
  signal_counts: Record<string, number>;
  open_signal_counts: Record<string, number>;
  by_domain: Record<string, number>;
  by_status: Record<string, number>;
  most_common_open_signal: null | string;
  most_reliable_signal: null | { signal: string; rate: number; total: number };
  least_reliable_signal: null | { signal: string; rate: number; total: number };
};

const SIGNAL_COLOR: Record<string, string> = {
  warning: SALMON,
  pull: MINT,
  suspicion: AMBER,
  trust: MINT,
  unease: PEACH,
  certainty: BLUE,
  dread: SALMON,
  nudge: LAVENDER,
  hunch: LAVENDER,
};

const SIGNAL_LABEL: Record<string, string> = {
  warning: "WARNING",
  pull: "PULL",
  suspicion: "SUSPICION",
  trust: "TRUST",
  unease: "UNEASE",
  certainty: "CERTAINTY",
  dread: "DREAD",
  nudge: "NUDGE",
  hunch: "HUNCH",
};

const STATUS_COLOR: Record<string, string> = {
  open: SALMON,
  verified_right: MINT,
  verified_wrong: PEACH,
  ignored_regret: SALMON,
  ignored_relief: SAGE,
  unresolved: AMBER,
  dismissed: TAUPE,
  archived: TAUPE,
};

const STATUS_LABEL: Record<string, string> = {
  open: "OPEN",
  verified_right: "VERIFIED RIGHT",
  verified_wrong: "VERIFIED WRONG",
  ignored_regret: "IGNORED · REGRET",
  ignored_relief: "IGNORED · RELIEF",
  unresolved: "UNRESOLVED",
  dismissed: "DISMISSED",
  archived: "ARCHIVED",
};

const STATUS_BLURB: Record<string, string> = {
  verified_right: "you trusted your gut and it was right. vindicated. note what happened",
  verified_wrong: "you trusted your gut and it was off. costly. be honest — this is the calibration data",
  ignored_regret: "you didn't follow it and it turned out right. the 'I knew' regret. note what you missed",
  ignored_relief: "you didn't follow it and it turned out to be off. glad you didn't. note why",
  unresolved: "the outcome is still unfolding. flag it as pending without closing it",
};

const SIGNALS = ["warning", "pull", "suspicion", "trust", "unease", "certainty", "dread", "nudge", "hunch"];
const DOMAINS = ["relationships", "work", "money", "health", "decision", "opportunity", "risk", "self", "unknown"];

type ResolveMode = "verified_right" | "verified_wrong" | "ignored_regret" | "ignored_relief" | "unresolved" | null;

function ymd(date: string): string { return date.slice(0, 10); }

export function GutCheckConsole() {
  const [rows, setRows] = useState<GutCheck[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [windowDays, setWindowDays] = useState(180);

  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [signalFilter, setSignalFilter] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [minCharge, setMinCharge] = useState<number>(1);

  const [resolveTarget, setResolveTarget] = useState<GutCheck | null>(null);
  const [resolveMode, setResolveMode] = useState<ResolveMode>(null);
  const [resolveNote, setResolveNote] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (signalFilter) params.set("signal_kind", signalFilter);
    if (domainFilter) params.set("domain", domainFilter);
    if (minCharge > 1) params.set("min_charge", String(minCharge));
    params.set("limit", "200");
    const r = await fetch(`/api/gut-checks?${params.toString()}`);
    const j = await r.json();
    setRows(j.gut_checks ?? []);
    setStats(j.stats ?? null);
    setLoading(false);
  }, [statusFilter, signalFilter, domainFilter, minCharge]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await fetch("/api/gut-checks/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error || "scan failed");
      } else if ((j.inserted ?? 0) === 0) {
        alert(j.message || "no gut-checks detected — try a wider window");
      }
    } finally {
      setScanning(false);
      fetchRows();
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/gut-checks/${id}`, {
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
    const requiresNote = resolveMode !== "unresolved";
    if (requiresNote && note.length < 4) { alert("needs a sentence — at least 4 characters"); return; }
    const body: Record<string, unknown> = { mode: resolveMode };
    if (note.length >= 4) body.resolution_note = note;
    const ok = await patch(resolveTarget.id, body);
    if (ok) {
      setResolveTarget(null);
      setResolveMode(null);
      setResolveNote("");
      fetchRows();
    }
  };

  const onPin = async (g: GutCheck) => { if (await patch(g.id, { mode: g.pinned ? "unpin" : "pin" })) fetchRows(); };
  const onArchive = async (g: GutCheck) => { if (await patch(g.id, { mode: g.archived_at ? "restore" : "archive" })) fetchRows(); };
  const onDismiss = async (g: GutCheck) => { if (await patch(g.id, { mode: "dismiss" })) fetchRows(); };
  const onUnresolve = async (g: GutCheck) => { if (await patch(g.id, { mode: "unresolve" })) fetchRows(); };
  const onDelete = async (g: GutCheck) => {
    if (!confirm("Delete this entry?")) return;
    const r = await fetch(`/api/gut-checks/${g.id}`, { method: "DELETE" });
    if (r.ok) fetchRows();
  };

  const openResolve = (g: GutCheck, mode: ResolveMode) => {
    setResolveTarget(g);
    setResolveMode(mode);
    setResolveNote("");
  };

  const placeholder = useMemo(() => {
    if (resolveMode === "verified_right") return "what happened that proved your gut right? what did you sense before you could explain?";
    if (resolveMode === "verified_wrong") return "what happened that showed your gut was off? be honest — this is the calibration data";
    if (resolveMode === "ignored_regret") return "what happened that you wish you'd listened to your gut about?";
    if (resolveMode === "ignored_relief") return "why are you glad you didn't follow your gut on this one?";
    if (resolveMode === "unresolved") return "what's still in flight? (optional)";
    return "";
  }, [resolveMode]);

  const modeColor = (m: ResolveMode): string => {
    if (m === "verified_right") return MINT;
    if (m === "verified_wrong") return PEACH;
    if (m === "ignored_regret") return SALMON;
    if (m === "ignored_relief") return SAGE;
    if (m === "unresolved") return AMBER;
    return TAUPE;
  };

  return (
    <div style={{ padding: "16px 20px 80px", color: BONE, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${TAUPE}33` }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>the felt signals before the reasons</div>
          <div style={{ fontSize: 13, color: BONE, marginTop: 4, fontStyle: "italic", fontFamily: "Georgia, serif" }}>
            calibrate what you trust. measure your gut empirically.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>window</span>
          {[30, 60, 90, 180, 365, 540].map((d) => (
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
              {d < 90 ? `${d}d` : d < 365 ? `${Math.round(d/30)}mo` : d === 365 ? "1y" : "1.5y"}
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
          {scanning ? "scanning..." : "Find gut-checks"}
        </button>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="open" value={stats.open} sub={stats.load_bearing_open > 0 ? `${stats.load_bearing_open} load-bearing` : "awaiting outcome"} color={SALMON} />
          <StatCard label="gut accuracy" value={`${stats.gut_accuracy_rate}%`} sub={`right ${stats.quadrant.verified_right + stats.quadrant.ignored_regret} of ${stats.quadrant.verified_right + stats.quadrant.verified_wrong + stats.quadrant.ignored_regret + stats.quadrant.ignored_relief} resolved`} color={MINT} />
          <StatCard label="trust calibration" value={`${stats.gut_trust_rate}%`} sub="right outcomes from your followthrough" color={AMBER} />
          <StatCard label="resolved" value={stats.verified_right + stats.verified_wrong + stats.ignored_regret + stats.ignored_relief} sub={stats.unresolved > 0 ? `${stats.unresolved} pending` : "calibration data"} color={LAVENDER} />
        </div>
      )}

      {stats && (stats.quadrant.verified_right + stats.quadrant.verified_wrong + stats.quadrant.ignored_regret + stats.quadrant.ignored_relief) > 0 && (
        <QuadrantMatrix
          q={stats.quadrant}
          accuracy={stats.gut_accuracy_rate}
          trust={stats.gut_trust_rate}
          mostReliable={stats.most_reliable_signal}
          leastReliable={stats.least_reliable_signal}
        />
      )}

      <FilterRow label="status">
        {["open", "verified_right", "verified_wrong", "ignored_regret", "ignored_relief", "unresolved", "dismissed", "pinned", "all"].map((s) => (
          <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} color={STATUS_COLOR[s] || (s === "pinned" ? LAVENDER : TAUPE)}>{(STATUS_LABEL[s] || s).toLowerCase()}</Pill>
        ))}
      </FilterRow>

      <FilterRow label="signal">
        <Pill active={signalFilter === ""} onClick={() => setSignalFilter("")} color={BONE}>all</Pill>
        {SIGNALS.map((s) => (
          <Pill key={s} active={signalFilter === s} onClick={() => setSignalFilter(s)} color={SIGNAL_COLOR[s] || TAUPE}>{s}</Pill>
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

      <div style={{ marginTop: 16 }}>
        {loading ? (
          <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>loading...</div>
        ) : rows.length === 0 ? (
          <div style={{ color: TAUPE, fontStyle: "italic", padding: 24 }}>
            nothing in this view. press FIND GUT-CHECKS — the scan reads recent chats for &ldquo;something feels off&rdquo; / &ldquo;my gut says&rdquo; / &ldquo;I just know&rdquo; patterns.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((g) => <Card key={g.id} g={g} onResolve={(m) => openResolve(g, m)} onPin={() => onPin(g)} onArchive={() => onArchive(g)} onDismiss={() => onDismiss(g)} onUnresolve={() => onUnresolve(g)} onDelete={() => onDelete(g)} />)}
          </div>
        )}
      </div>

      {resolveTarget && resolveMode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { setResolveTarget(null); setResolveMode(null); setResolveNote(""); }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600, width: "100%", background: "#0a0a0a", border: `2px solid ${modeColor(resolveMode)}`, padding: 24, borderRadius: 4 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: modeColor(resolveMode), marginBottom: 6 }}>
              {STATUS_LABEL[resolveMode] || resolveMode}
            </div>
            <div style={{ fontSize: 13, fontStyle: "italic", color: BONE, marginBottom: 14, fontFamily: "Georgia, serif" }}>
              {STATUS_BLURB[resolveMode] || ""}
            </div>
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 4 }}>the gut signal</div>
            <div style={{ fontSize: 14, color: BONE, fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 10, lineHeight: 1.5 }}>
              you sensed: <span style={{ color: modeColor(resolveMode) }}>{resolveTarget.gut_text}</span>
            </div>
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 4 }}>signal</div>
            <div style={{ fontSize: 13, color: SIGNAL_COLOR[resolveTarget.signal_kind] || TAUPE, marginBottom: 14, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {SIGNAL_LABEL[resolveTarget.signal_kind] || resolveTarget.signal_kind}
              {resolveTarget.subject_text && <span style={{ color: BONE, fontStyle: "italic", textTransform: "none", fontFamily: "Georgia, serif", letterSpacing: 0, marginLeft: 8 }}>(about {resolveTarget.subject_text})</span>}
            </div>
            <textarea
              autoFocus
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder={placeholder}
              style={{ width: "100%", minHeight: 80, background: "#000", color: BONE, border: `1px solid ${TAUPE}55`, padding: 10, fontFamily: "Georgia, serif", fontSize: 14, fontStyle: "italic", borderRadius: 2, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button onClick={() => { setResolveTarget(null); setResolveMode(null); setResolveNote(""); }} style={{ background: "transparent", color: TAUPE, border: `1px solid ${TAUPE}55`, padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>cancel</button>
              <button onClick={submitResolve} style={{ background: modeColor(resolveMode), color: "#0a0a0a", border: "none", padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600 }}>confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// THE NOVEL VISUALISATION — 2x2 quadrant matrix.
//
//                      Followed gut       Didn't follow
//   Gut was right      VERIFIED_RIGHT     IGNORED_REGRET
//   Gut was wrong      VERIFIED_WRONG     IGNORED_RELIEF
//
// Distribution shows the user empirically whether their gut is reliable
// AND whether their followthrough on gut signals is calibrated.
function QuadrantMatrix({ q, accuracy, trust, mostReliable, leastReliable }: {
  q: { verified_right: number; verified_wrong: number; ignored_regret: number; ignored_relief: number };
  accuracy: number;
  trust: number;
  mostReliable: null | { signal: string; rate: number; total: number };
  leastReliable: null | { signal: string; rate: number; total: number };
}) {
  const total = q.verified_right + q.verified_wrong + q.ignored_regret + q.ignored_relief;
  if (total === 0) return null;
  const pct = (n: number) => Math.round((n / total) * 100);

  // Interpretation footer
  let interpretation = "";
  if (accuracy >= 70) interpretation = `your gut has been right ${accuracy}% of the time. trust it more.`;
  else if (accuracy <= 35) interpretation = `your gut has been off ${100 - accuracy}% of the time. question it more.`;
  else interpretation = `your gut accuracy is ${accuracy}% — close to chance. interpret each signal on its own.`;

  return (
    <div style={{ background: `${LAVENDER}08`, border: `1px solid ${LAVENDER}33`, padding: "14px 16px", marginBottom: 16, borderRadius: 2 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", color: LAVENDER, textTransform: "uppercase", marginBottom: 12 }}>your gut calibration · the quadrant</div>

      {/* Header row labels */}
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 6, marginBottom: 4 }}>
        <div />
        <div style={{ fontSize: 9, color: TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", textAlign: "center" }}>followed gut</div>
        <div style={{ fontSize: 9, color: TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", textAlign: "center" }}>didn&rsquo;t follow</div>
      </div>

      {/* Top row — gut was right */}
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 6, marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", display: "flex", alignItems: "center" }}>gut was right</div>
        <QuadCell color={MINT} label="vindicated" count={q.verified_right} pct={pct(q.verified_right)} />
        <QuadCell color={SALMON} label="regret" count={q.ignored_regret} pct={pct(q.ignored_regret)} />
      </div>

      {/* Bottom row — gut was wrong */}
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 6, marginBottom: 12 }}>
        <div style={{ fontSize: 9, color: TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", display: "flex", alignItems: "center" }}>gut was wrong</div>
        <QuadCell color={PEACH} label="costly" count={q.verified_wrong} pct={pct(q.verified_wrong)} />
        <QuadCell color={SAGE} label="relief" count={q.ignored_relief} pct={pct(q.ignored_relief)} />
      </div>

      <div style={{ fontSize: 11, color: BONE, marginTop: 8, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.6 }}>
        {interpretation}
        {trust !== accuracy && (
          <> your <span style={{ color: AMBER }}>trust calibration</span> is {trust}% — that&rsquo;s how often your followthrough decision (trust or override) actually matched the right call.</>
        )}
        {mostReliable && mostReliable.total >= 3 && mostReliable.rate >= 70 && (
          <> your most reliable signal flavour is <span style={{ color: SIGNAL_COLOR[mostReliable.signal] || TAUPE }}>{(SIGNAL_LABEL[mostReliable.signal] || mostReliable.signal).toLowerCase()}</span> ({mostReliable.rate}% accurate over {mostReliable.total} resolved).</>
        )}
        {leastReliable && leastReliable.total >= 3 && leastReliable.rate < 50 && (
          <> least reliable: <span style={{ color: SALMON }}>{(SIGNAL_LABEL[leastReliable.signal] || leastReliable.signal).toLowerCase()}</span> ({leastReliable.rate}% over {leastReliable.total}).</>
        )}
      </div>
    </div>
  );
}

function QuadCell({ color, label, count, pct }: { color: string; label: string; count: number; pct: number }) {
  return (
    <div style={{ background: `${color}10`, border: `1px solid ${color}55`, padding: "10px 12px", borderRadius: 2, textAlign: "center" }}>
      <div style={{ fontSize: 24, color: BONE, fontWeight: 300, lineHeight: 1 }}>{count}</div>
      <div style={{ fontSize: 9, color, letterSpacing: "0.18em", textTransform: "uppercase", marginTop: 4 }}>{label}</div>
      <div style={{ fontSize: 9, color: TAUPE, marginTop: 2 }}>{pct}%</div>
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

function Card({ g, onResolve, onPin, onArchive, onDismiss, onUnresolve, onDelete }: {
  g: GutCheck;
  onResolve: (mode: ResolveMode) => void;
  onPin: () => void;
  onArchive: () => void;
  onDismiss: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
}) {
  const isOpen = g.status === "open";
  const isResolved = ["verified_right", "verified_wrong", "ignored_regret", "ignored_relief", "unresolved"].includes(g.status);
  const accent = isOpen ? SIGNAL_COLOR[g.signal_kind] || TAUPE : STATUS_COLOR[g.status] || TAUPE;
  const archived = !!g.archived_at;

  return (
    <div style={{ borderLeft: `3px solid ${accent}`, background: archived ? "#0a0a0a55" : "#0a0a0a", padding: "14px 16px", borderRadius: "0 2px 2px 0", opacity: archived ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.18em", color: SIGNAL_COLOR[g.signal_kind] || TAUPE, textTransform: "uppercase" }}>{SIGNAL_LABEL[g.signal_kind] || g.signal_kind}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em" }}>{g.domain}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: TAUPE }}>sensed {ymd(g.spoken_date)}</span>
        {g.pinned && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, color: LAVENDER }}>● pinned</span></>)}
        {!isOpen && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, padding: "1px 6px", border: `1px solid ${STATUS_COLOR[g.status] || TAUPE}55`, color: STATUS_COLOR[g.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", borderRadius: 2 }}>{STATUS_LABEL[g.status] || g.status}</span></>)}
        <div style={{ marginLeft: "auto" }}><ChargeMeter value={g.charge} /></div>
      </div>

      <div style={{ fontSize: 16, fontFamily: "Georgia, serif", fontStyle: "italic", color: BONE, marginBottom: 8, lineHeight: 1.45 }}>
        you sensed: <span style={{ color: accent }}>{g.gut_text}</span>
        {g.subject_text && <span style={{ color: TAUPE, fontStyle: "italic" }}> · about {g.subject_text}</span>}
      </div>

      {g.resolution_note && isResolved && (
        <div style={{ background: `${STATUS_COLOR[g.status] || TAUPE}10`, border: `1px solid ${STATUS_COLOR[g.status] || TAUPE}55`, padding: "8px 12px", marginTop: 8, marginBottom: 12, borderRadius: 2 }}>
          <div style={{ fontSize: 10, color: STATUS_COLOR[g.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>
            {STATUS_LABEL[g.status]}
          </div>
          <div style={{ fontSize: 13, color: BONE, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>{g.resolution_note}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        {isOpen ? (
          <>
            <ActionButton color={MINT} onClick={() => onResolve("verified_right")}>verified right</ActionButton>
            <ActionButton color={PEACH} onClick={() => onResolve("verified_wrong")}>verified wrong</ActionButton>
            <ActionButton color={SALMON} onClick={() => onResolve("ignored_regret")}>ignored · regret</ActionButton>
            <ActionButton color={SAGE} onClick={() => onResolve("ignored_relief")}>ignored · relief</ActionButton>
            <ActionButton color={AMBER} onClick={() => onResolve("unresolved")}>still unfolding</ActionButton>
            <ActionButton color={TAUPE} onClick={onDismiss}>dismiss</ActionButton>
          </>
        ) : isResolved ? (
          <ActionButton color={TAUPE} onClick={onUnresolve}>unresolve</ActionButton>
        ) : null}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <ActionButton color={LAVENDER} onClick={onPin}>{g.pinned ? "unpin" : "pin"}</ActionButton>
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
