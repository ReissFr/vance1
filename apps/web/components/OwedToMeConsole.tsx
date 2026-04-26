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

type Owed = {
  id: string;
  scan_id: string | null;
  promise_text: string;
  horizon_text: string;
  horizon_kind: string;
  relationship_with: string;
  person_text: string | null;
  domain: string;
  charge: number;
  recency: string;
  spoken_date: string;
  spoken_message_id: string;
  conversation_id: string | null;
  target_date: string;
  confidence: number;
  status: string;
  resolution_note: string | null;
  raised_outcome: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  open: number;
  kept: number;
  broken: number;
  forgotten: number;
  raised: number;
  released: number;
  dismissed: number;
  pinned: number;
  overdue_count: number;
  due_today: number;
  due_this_week: number;
  load_bearing_open: number;
  follow_through_received_rate: number;
  raised_follow_through_rate: number;
  per_relationship_rate: Record<string, { kept: number; total: number; rate: number }>;
  per_horizon_rate: Record<string, { kept: number; total: number; rate: number }>;
  relationship_counts: Record<string, number>;
  open_relationship_counts: Record<string, number>;
  by_domain: Record<string, number>;
  by_horizon: Record<string, number>;
  by_status: Record<string, number>;
  raised_outcome_counts: Record<string, number>;
  most_common_open_relationship: null | string;
  least_promising_relationship: null | { relationship: string; rate: number; total: number };
  most_promising_relationship: null | { relationship: string; rate: number; total: number };
};

const REL_COLOR: Record<string, string> = {
  partner: PEACH,
  parent: SALMON,
  sibling: AMBER,
  friend: MINT,
  colleague: BLUE,
  boss: LAVENDER,
  client: SAGE,
  stranger: TAUPE,
  unknown: TAUPE,
};

const REL_LABEL: Record<string, string> = {
  partner: "PARTNER",
  parent: "PARENT",
  sibling: "SIBLING",
  friend: "FRIEND",
  colleague: "COLLEAGUE",
  boss: "BOSS",
  client: "CLIENT",
  stranger: "STRANGER",
  unknown: "UNKNOWN",
};

const STATUS_COLOR: Record<string, string> = {
  open: SALMON,
  kept: MINT,
  raised: AMBER,
  broken: SALMON,
  forgotten: LAVENDER,
  released: SAGE,
  dismissed: TAUPE,
  archived: TAUPE,
};

const STATUS_LABEL: Record<string, string> = {
  open: "OPEN",
  kept: "KEPT",
  raised: "RAISED",
  broken: "BROKEN",
  forgotten: "FORGOTTEN",
  released: "RELEASED",
  dismissed: "DISMISSED",
  archived: "ARCHIVED",
};

const RAISED_OUTCOME_LABEL: Record<string, string> = {
  they_followed_through: "they followed through",
  they_apologized: "they apologized",
  they_explained: "they explained",
  they_dismissed_it: "they dismissed it",
  no_response: "no response",
};

const STATUS_BLURB: Record<string, string> = {
  kept: "they did the thing. mark it done and let it go",
  raised: "you brought it up. the cognitive weight transfers from your head into a real exchange",
  broken: "they explicitly didn't follow through. name what they said",
  forgotten: "they probably forgot. name your read on why and that you're letting it go",
  released: "you've decided to stop expecting it. it sits without weight now",
};

const RELATIONSHIPS = ["partner", "parent", "sibling", "friend", "colleague", "boss", "client", "stranger", "unknown"];
const DOMAINS = ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"];
const RAISED_OUTCOMES = ["they_followed_through", "they_apologized", "they_explained", "they_dismissed_it", "no_response"];

type ResolveMode = "kept" | "raised" | "broken" | "forgotten" | "released" | null;

function ymd(date: string): string { return date.slice(0, 10); }

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysUntil(target: string): number {
  const today = new Date(`${todayYmd()}T00:00:00Z`).getTime();
  const t = new Date(`${target}T00:00:00Z`).getTime();
  return Math.round((t - today) / 86_400_000);
}

export function OwedToMeConsole() {
  const [rows, setRows] = useState<Owed[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [windowDays, setWindowDays] = useState(60);

  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [relationshipFilter, setRelationshipFilter] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [minCharge, setMinCharge] = useState<number>(1);

  const [resolveTarget, setResolveTarget] = useState<Owed | null>(null);
  const [resolveMode, setResolveMode] = useState<ResolveMode>(null);
  const [resolveNote, setResolveNote] = useState("");
  const [raisedOutcome, setRaisedOutcome] = useState<string>("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (relationshipFilter) params.set("relationship_with", relationshipFilter);
    if (domainFilter) params.set("domain", domainFilter);
    if (minCharge > 1) params.set("min_charge", String(minCharge));
    params.set("limit", "200");
    const r = await fetch(`/api/owed-to-me?${params.toString()}`);
    const j = await r.json();
    setRows(j.owed_to_me ?? []);
    setStats(j.stats ?? null);
    setLoading(false);
  }, [statusFilter, relationshipFilter, domainFilter, minCharge]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await fetch("/api/owed-to-me/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error || "scan failed");
      } else if ((j.inserted ?? 0) === 0) {
        alert(j.message || "no reported-promises detected — try a wider window");
      }
    } finally {
      setScanning(false);
      fetchRows();
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/owed-to-me/${id}`, {
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
    const requiresNote = resolveMode === "raised" || resolveMode === "broken" || resolveMode === "forgotten";
    if (requiresNote && note.length < 4) { alert("needs a sentence — at least 4 characters"); return; }
    const body: Record<string, unknown> = { mode: resolveMode };
    if (note.length >= 4) body.resolution_note = note;
    if (resolveMode === "raised" && raisedOutcome) body.raised_outcome = raisedOutcome;
    const ok = await patch(resolveTarget.id, body);
    if (ok) {
      setResolveTarget(null);
      setResolveMode(null);
      setResolveNote("");
      setRaisedOutcome("");
      fetchRows();
    }
  };

  const onPin = async (p: Owed) => { if (await patch(p.id, { mode: p.pinned ? "unpin" : "pin" })) fetchRows(); };
  const onArchive = async (p: Owed) => { if (await patch(p.id, { mode: p.archived_at ? "restore" : "archive" })) fetchRows(); };
  const onDismiss = async (p: Owed) => { if (await patch(p.id, { mode: "dismiss" })) fetchRows(); };
  const onUnresolve = async (p: Owed) => { if (await patch(p.id, { mode: "unresolve" })) fetchRows(); };
  const onDelete = async (p: Owed) => {
    if (!confirm("Delete this entry?")) return;
    const r = await fetch(`/api/owed-to-me/${p.id}`, { method: "DELETE" });
    if (r.ok) fetchRows();
  };

  const openResolve = (p: Owed, mode: ResolveMode) => {
    setResolveTarget(p);
    setResolveMode(mode);
    setResolveNote("");
    setRaisedOutcome("");
  };

  const placeholder = useMemo(() => {
    if (resolveMode === "kept") return "anything to note — how it landed, when, what tone? (optional)";
    if (resolveMode === "raised") return "what did you say when you brought it up?";
    if (resolveMode === "broken") return "what did they say when they declined / what changed?";
    if (resolveMode === "forgotten") return "your read on why this slipped — and that you're letting it go";
    if (resolveMode === "released") return "what shifted that you no longer expect this? (optional)";
    return "";
  }, [resolveMode]);

  const modeColor = (m: ResolveMode): string => {
    if (m === "kept") return MINT;
    if (m === "raised") return AMBER;
    if (m === "broken") return SALMON;
    if (m === "forgotten") return LAVENDER;
    if (m === "released") return SAGE;
    return TAUPE;
  };

  return (
    <div style={{ padding: "16px 20px 80px", color: BONE, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${TAUPE}33` }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>the promises others made you</div>
          <div style={{ fontSize: 13, color: BONE, marginTop: 4, fontStyle: "italic", fontFamily: "Georgia, serif" }}>
            who&apos;s quietly taking up your bandwidth? bring it up. make the conversation.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>window</span>
          {[14, 30, 60, 90, 180].map((d) => (
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
              {d < 30 ? `${d}d` : d < 90 ? `${d}d` : `${Math.round(d/30)}mo`}
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
          {scanning ? "scanning..." : "Find what's owed to you"}
        </button>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="open" value={stats.open} sub={stats.overdue_count > 0 ? `${stats.overdue_count} overdue` : `${stats.due_this_week} due this week`} color={SALMON} />
          <StatCard label="load-bearing open" value={stats.load_bearing_open} sub="charge ≥ 4" color={AMBER} />
          <StatCard label="follow-through" value={`${stats.follow_through_received_rate}%`} sub={`${stats.kept} kept of ${stats.kept + stats.broken + stats.forgotten} resolved`} color={MINT} />
          <StatCard label="raised" value={stats.raised} sub={stats.raised_follow_through_rate > 0 ? `${stats.raised_follow_through_rate}% followed through after` : "you brought it up"} color={LAVENDER} />
        </div>
      )}

      {stats && stats.open > 0 && (
        <RelationshipBreakdown counts={stats.open_relationship_counts} total={stats.open} worst={stats.least_promising_relationship} />
      )}

      <FilterRow label="status">
        {["open", "kept", "raised", "broken", "forgotten", "released", "dismissed", "pinned", "all"].map((s) => (
          <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} color={STATUS_COLOR[s] || (s === "pinned" ? LAVENDER : TAUPE)}>{s.replace(/_/g, " ")}</Pill>
        ))}
      </FilterRow>

      <FilterRow label="from">
        <Pill active={relationshipFilter === ""} onClick={() => setRelationshipFilter("")} color={BONE}>all</Pill>
        {RELATIONSHIPS.map((s) => (
          <Pill key={s} active={relationshipFilter === s} onClick={() => setRelationshipFilter(s)} color={REL_COLOR[s] || TAUPE}>{s}</Pill>
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
            nothing in this view. press FIND WHAT&rsquo;S OWED TO YOU — the scan reads recent chats for &ldquo;she said she&rsquo;d&rdquo; / &ldquo;he promised&rdquo; / &ldquo;they were supposed to&rdquo; patterns.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((p) => <Card key={p.id} p={p} onResolve={(m) => openResolve(p, m)} onPin={() => onPin(p)} onArchive={() => onArchive(p)} onDismiss={() => onDismiss(p)} onUnresolve={() => onUnresolve(p)} onDelete={() => onDelete(p)} />)}
          </div>
        )}
      </div>

      {resolveTarget && resolveMode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { setResolveTarget(null); setResolveMode(null); setResolveNote(""); setRaisedOutcome(""); }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600, width: "100%", background: "#0a0a0a", border: `2px solid ${modeColor(resolveMode)}`, padding: 24, borderRadius: 4 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: modeColor(resolveMode), marginBottom: 6 }}>
              {resolveMode === "kept" ? "MARK KEPT" : resolveMode === "raised" ? "MARK AS RAISED" : resolveMode === "broken" ? "MARK BROKEN" : resolveMode === "forgotten" ? "MARK FORGOTTEN" : "RELEASE"}
            </div>
            <div style={{ fontSize: 13, fontStyle: "italic", color: BONE, marginBottom: 14, fontFamily: "Georgia, serif" }}>
              {resolveMode ? STATUS_BLURB[resolveMode] : ""}
            </div>
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 4 }}>the promise</div>
            <div style={{ fontSize: 14, color: BONE, fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 10, lineHeight: 1.5 }}>
              {resolveTarget.person_text || (REL_LABEL[resolveTarget.relationship_with] || resolveTarget.relationship_with).toLowerCase()} said they&rsquo;d <span style={{ color: modeColor(resolveMode) }}>{resolveTarget.promise_text}</span>
              {resolveTarget.horizon_text && <span style={{ color: TAUPE }}> {resolveTarget.horizon_text}</span>}
            </div>
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 4 }}>from</div>
            <div style={{ fontSize: 13, color: REL_COLOR[resolveTarget.relationship_with] || TAUPE, marginBottom: 14, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {REL_LABEL[resolveTarget.relationship_with] || resolveTarget.relationship_with}
              {resolveTarget.person_text && <span style={{ color: BONE, fontStyle: "italic", textTransform: "none", fontFamily: "Georgia, serif", letterSpacing: 0, marginLeft: 8 }}>({resolveTarget.person_text})</span>}
            </div>
            <textarea
              autoFocus
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder={placeholder}
              style={{ width: "100%", minHeight: 80, background: "#000", color: BONE, border: `1px solid ${TAUPE}55`, padding: 10, fontFamily: "Georgia, serif", fontSize: 14, fontStyle: "italic", borderRadius: 2, resize: "vertical" }}
            />
            {resolveMode === "raised" && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, color: TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>and what happened? (optional)</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <Pill active={raisedOutcome === ""} onClick={() => setRaisedOutcome("")} color={TAUPE}>not yet</Pill>
                  {RAISED_OUTCOMES.map((o) => (
                    <Pill key={o} active={raisedOutcome === o} onClick={() => setRaisedOutcome(o)} color={o === "they_followed_through" ? MINT : o === "no_response" ? SALMON : LAVENDER}>
                      {RAISED_OUTCOME_LABEL[o]}
                    </Pill>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
              <button onClick={() => { setResolveTarget(null); setResolveMode(null); setResolveNote(""); setRaisedOutcome(""); }} style={{ background: "transparent", color: TAUPE, border: `1px solid ${TAUPE}55`, padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2 }}>cancel</button>
              <button onClick={submitResolve} style={{ background: modeColor(resolveMode), color: "#0a0a0a", border: "none", padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600 }}>confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RelationshipBreakdown({ counts, total, worst }: { counts: Record<string, number>; total: number; worst: null | { relationship: string; rate: number; total: number } }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0 || total === 0) return null;
  const top = entries[0];
  if (!top) return null;
  return (
    <div style={{ background: `${LAVENDER}08`, border: `1px solid ${LAVENDER}33`, padding: "12px 14px", marginBottom: 16, borderRadius: 2 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", color: LAVENDER, textTransform: "uppercase", marginBottom: 8 }}>who&apos;s quietly taking up your bandwidth</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map(([rel, count]) => {
          const pct = Math.round((count / total) * 100);
          return (
            <div key={rel} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ minWidth: 110, fontSize: 10, color: REL_COLOR[rel] || TAUPE, letterSpacing: "0.15em", textTransform: "uppercase" }}>{REL_LABEL[rel] || rel}</div>
              <div style={{ flex: 1, height: 8, background: `${TAUPE}22`, borderRadius: 1, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: REL_COLOR[rel] || TAUPE }} />
              </div>
              <div style={{ minWidth: 64, fontSize: 10, color: TAUPE, textAlign: "right" }}>{count} · {pct}%</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: BONE, marginTop: 10, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>
        most of your open promises come from <span style={{ color: REL_COLOR[top[0]] || TAUPE }}>{(REL_LABEL[top[0]] || top[0]).toLowerCase()}</span>.
        {worst && worst.total >= 3 && worst.rate < 60 && (
          <> {worst.relationship === top[0] ? "and " : ""}only <span style={{ color: SALMON }}>{worst.rate}%</span> of resolved promises from <span style={{ color: REL_COLOR[worst.relationship] || TAUPE }}>{(REL_LABEL[worst.relationship] || worst.relationship).toLowerCase()}</span> have been kept.</>
        )}
      </div>
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

function Card({ p, onResolve, onPin, onArchive, onDismiss, onUnresolve, onDelete }: {
  p: Owed;
  onResolve: (mode: ResolveMode) => void;
  onPin: () => void;
  onArchive: () => void;
  onDismiss: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
}) {
  const isOpen = p.status === "open";
  const isResolved = ["kept", "raised", "broken", "forgotten", "released"].includes(p.status);
  const accent = isOpen ? REL_COLOR[p.relationship_with] || TAUPE : STATUS_COLOR[p.status] || TAUPE;
  const archived = !!p.archived_at;
  const overdue = isOpen && p.target_date < todayYmd();
  const dueIn = isOpen ? daysUntil(p.target_date) : null;

  return (
    <div style={{ borderLeft: `3px solid ${accent}`, background: archived ? "#0a0a0a55" : "#0a0a0a", padding: "14px 16px", borderRadius: "0 2px 2px 0", opacity: archived ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.18em", color: REL_COLOR[p.relationship_with] || TAUPE, textTransform: "uppercase" }}>{REL_LABEL[p.relationship_with] || p.relationship_with}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em" }}>{p.domain}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: TAUPE }}>said {ymd(p.spoken_date)}</span>
        {isOpen && dueIn !== null && (
          <>
            <span style={{ fontSize: 10, color: TAUPE }}>·</span>
            <span style={{ fontSize: 10, color: overdue ? SALMON : dueIn <= 7 ? AMBER : TAUPE, letterSpacing: "0.1em" }}>
              {overdue ? `${Math.abs(dueIn)}d overdue` : dueIn === 0 ? "due today" : dueIn === 1 ? "due tomorrow" : `due in ${dueIn}d`}
            </span>
          </>
        )}
        {p.pinned && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, color: LAVENDER }}>● pinned</span></>)}
        {!isOpen && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, padding: "1px 6px", border: `1px solid ${STATUS_COLOR[p.status] || TAUPE}55`, color: STATUS_COLOR[p.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", borderRadius: 2 }}>{STATUS_LABEL[p.status] || p.status}</span></>)}
        <div style={{ marginLeft: "auto" }}><ChargeMeter value={p.charge} /></div>
      </div>

      <div style={{ fontSize: 16, fontFamily: "Georgia, serif", fontStyle: "italic", color: BONE, marginBottom: 8, lineHeight: 1.45 }}>
        <span style={{ color: BONE }}>{p.person_text || (REL_LABEL[p.relationship_with] || p.relationship_with).toLowerCase()}</span> said they&rsquo;d <span style={{ color: accent }}>{p.promise_text}</span>
        {p.horizon_text && <span style={{ color: TAUPE, fontStyle: "italic" }}> {p.horizon_text}</span>}
      </div>

      {p.resolution_note && isResolved && (
        <div style={{ background: `${STATUS_COLOR[p.status] || TAUPE}10`, border: `1px solid ${STATUS_COLOR[p.status] || TAUPE}55`, padding: "8px 12px", marginTop: 8, marginBottom: 12, borderRadius: 2 }}>
          <div style={{ fontSize: 10, color: STATUS_COLOR[p.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>
            {STATUS_LABEL[p.status]}
            {p.status === "raised" && p.raised_outcome && (
              <span style={{ marginLeft: 8, color: p.raised_outcome === "they_followed_through" ? MINT : p.raised_outcome === "no_response" ? SALMON : LAVENDER }}>
                · {RAISED_OUTCOME_LABEL[p.raised_outcome]}
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: BONE, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>{p.resolution_note}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        {isOpen ? (
          <>
            <ActionButton color={MINT} onClick={() => onResolve("kept")}>kept</ActionButton>
            <ActionButton color={AMBER} onClick={() => onResolve("raised")}>raise it</ActionButton>
            <ActionButton color={SALMON} onClick={() => onResolve("broken")}>broken</ActionButton>
            <ActionButton color={LAVENDER} onClick={() => onResolve("forgotten")}>forgotten</ActionButton>
            <ActionButton color={SAGE} onClick={() => onResolve("released")}>release</ActionButton>
            <ActionButton color={TAUPE} onClick={onDismiss}>dismiss</ActionButton>
          </>
        ) : isResolved ? (
          <ActionButton color={TAUPE} onClick={onUnresolve}>unresolve</ActionButton>
        ) : null}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <ActionButton color={LAVENDER} onClick={onPin}>{p.pinned ? "unpin" : "pin"}</ActionButton>
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
