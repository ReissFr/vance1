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

type Fear = {
  id: string;
  scan_id: string | null;
  fear_text: string;
  fear_kind: string;
  feared_subject: string | null;
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
  realised: number;
  partially_realised: number;
  dissolved: number;
  displaced: number;
  unresolved: number;
  dismissed: number;
  pinned: number;
  load_bearing_open: number;
  fear_realisation_rate: number;
  fear_overrun_rate: number;
  by_resolution: { realised: number; partially_realised: number; dissolved: number; displaced: number };
  per_kind_rate: Record<string, { realised: number; total: number; rate: number }>;
  per_domain_rate: Record<string, { realised: number; total: number; rate: number }>;
  kind_counts: Record<string, number>;
  open_kind_counts: Record<string, number>;
  by_domain: Record<string, number>;
  by_status: Record<string, number>;
  most_common_open_kind: null | string;
  most_realised_kind: null | { kind: string; rate: number; total: number };
  least_realised_kind: null | { kind: string; rate: number; total: number };
};

const KIND_COLOR: Record<string, string> = {
  catastrophising: SALMON,
  abandonment: SALMON,
  rejection: PEACH,
  failure: AMBER,
  loss: PEACH,
  shame: SALMON,
  inadequacy: AMBER,
  loss_of_control: AMBER,
  mortality: SALMON,
  future_uncertainty: LAVENDER,
};

const KIND_LABEL: Record<string, string> = {
  catastrophising: "CATASTROPHISING",
  abandonment: "ABANDONMENT",
  rejection: "REJECTION",
  failure: "FAILURE",
  loss: "LOSS",
  shame: "SHAME",
  inadequacy: "INADEQUACY",
  loss_of_control: "LOSS OF CONTROL",
  mortality: "MORTALITY",
  future_uncertainty: "FUTURE UNCERTAINTY",
};

const STATUS_COLOR: Record<string, string> = {
  open: SALMON,
  realised: SALMON,
  partially_realised: AMBER,
  dissolved: SAGE,
  displaced: LAVENDER,
  unresolved: AMBER,
  dismissed: TAUPE,
  archived: TAUPE,
};

const STATUS_LABEL: Record<string, string> = {
  open: "OPEN",
  realised: "REALISED",
  partially_realised: "PARTIALLY REALISED",
  dissolved: "DISSOLVED",
  displaced: "DISPLACED",
  unresolved: "UNRESOLVED",
  dismissed: "DISMISSED",
  archived: "ARCHIVED",
};

const STATUS_BLURB: Record<string, string> = {
  realised: "the feared event happened. note what actually unfolded — this is the prophetic-fear data",
  partially_realised: "some of it happened, not all. note what came true and what didn't",
  dissolved: "the feared event didn't happen and the fear is gone. note what actually unfolded — this is the never-came-true data",
  displaced: "this fear didn't realise but it's been replaced by another. name the new fear so the underlying pattern is visible",
  unresolved: "the outcome is still pending. flag it without closing",
};

const KINDS = ["catastrophising", "abandonment", "rejection", "failure", "loss", "shame", "inadequacy", "loss_of_control", "mortality", "future_uncertainty"];
const DOMAINS = ["relationships", "work", "money", "health", "decision", "opportunity", "safety", "self", "unknown"];

type ResolveMode = "realised" | "partially_realised" | "dissolved" | "displaced" | "unresolved" | null;

function ymd(date: string): string { return date.slice(0, 10); }

export function FearConsole() {
  const [rows, setRows] = useState<Fear[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [windowDays, setWindowDays] = useState(180);

  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [kindFilter, setKindFilter] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [minCharge, setMinCharge] = useState<number>(1);

  const [resolveTarget, setResolveTarget] = useState<Fear | null>(null);
  const [resolveMode, setResolveMode] = useState<ResolveMode>(null);
  const [resolveNote, setResolveNote] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (kindFilter) params.set("fear_kind", kindFilter);
    if (domainFilter) params.set("domain", domainFilter);
    if (minCharge > 1) params.set("min_charge", String(minCharge));
    params.set("limit", "200");
    const r = await fetch(`/api/fears?${params.toString()}`);
    const j = await r.json();
    setRows(j.fears ?? []);
    setStats(j.stats ?? null);
    setLoading(false);
  }, [statusFilter, kindFilter, domainFilter, minCharge]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await fetch("/api/fears/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error || "scan failed");
      } else if ((j.inserted ?? 0) === 0) {
        alert(j.message || "no fears detected — try a wider window");
      }
    } finally {
      setScanning(false);
      fetchRows();
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/fears/${id}`, {
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

  const onPin = async (f: Fear) => { if (await patch(f.id, { mode: f.pinned ? "unpin" : "pin" })) fetchRows(); };
  const onArchive = async (f: Fear) => { if (await patch(f.id, { mode: f.archived_at ? "restore" : "archive" })) fetchRows(); };
  const onDismiss = async (f: Fear) => { if (await patch(f.id, { mode: "dismiss" })) fetchRows(); };
  const onUnresolve = async (f: Fear) => { if (await patch(f.id, { mode: "unresolve" })) fetchRows(); };
  const onDelete = async (f: Fear) => {
    if (!confirm("Delete this entry?")) return;
    const r = await fetch(`/api/fears/${f.id}`, { method: "DELETE" });
    if (r.ok) fetchRows();
  };

  const openResolve = (f: Fear, mode: ResolveMode) => {
    setResolveTarget(f);
    setResolveMode(mode);
    setResolveNote("");
  };

  const placeholder = useMemo(() => {
    if (resolveMode === "realised") return "what actually happened that the fear was right about? this is the prophetic-fear data";
    if (resolveMode === "partially_realised") return "what part of the fear came true, and what didn't? be precise";
    if (resolveMode === "dissolved") return "the fear didn't happen — what actually unfolded? this is the never-came-true data";
    if (resolveMode === "displaced") return "this fear didn't realise but it's been replaced by another — name the replacement";
    if (resolveMode === "unresolved") return "what's still in flight? (optional)";
    return "";
  }, [resolveMode]);

  const modeColor = (m: ResolveMode): string => {
    if (m === "realised") return SALMON;
    if (m === "partially_realised") return AMBER;
    if (m === "dissolved") return SAGE;
    if (m === "displaced") return LAVENDER;
    if (m === "unresolved") return AMBER;
    return TAUPE;
  };

  return (
    <div style={{ padding: "16px 20px 80px", color: BONE, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${TAUPE}33` }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>the fears you've articulated, measured against what came</div>
          <div style={{ fontSize: 13, color: BONE, marginTop: 4, fontStyle: "italic", fontFamily: "Georgia, serif" }}>
            find out empirically how often your fears come true.
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
          {scanning ? "scanning..." : "Find fears"}
        </button>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="open" value={stats.open} sub={stats.load_bearing_open > 0 ? `${stats.load_bearing_open} bending behaviour` : "awaiting outcome"} color={SALMON} />
          <StatCard
            label="realisation rate"
            value={`${stats.fear_realisation_rate}%`}
            sub={`${stats.realised + stats.partially_realised * 0.5} of ${stats.realised + stats.partially_realised + stats.dissolved + stats.displaced} resolved`}
            color={SALMON}
          />
          <StatCard
            label="overrun rate"
            value={`${stats.fear_overrun_rate}%`}
            sub="cognitive bandwidth on fears that didn't realise"
            color={SAGE}
          />
          <StatCard label="resolved" value={stats.realised + stats.partially_realised + stats.dissolved + stats.displaced} sub={stats.unresolved > 0 ? `${stats.unresolved} pending` : "calibration data"} color={LAVENDER} />
        </div>
      )}

      {stats && (stats.realised + stats.partially_realised + stats.dissolved + stats.displaced) > 0 && (
        <FearRealityMap
          stats={stats}
        />
      )}

      <FilterRow label="status">
        {["open", "realised", "partially_realised", "dissolved", "displaced", "unresolved", "dismissed", "pinned", "all"].map((s) => (
          <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} color={STATUS_COLOR[s] || (s === "pinned" ? LAVENDER : TAUPE)}>{(STATUS_LABEL[s] || s).toLowerCase()}</Pill>
        ))}
      </FilterRow>

      <FilterRow label="kind">
        <Pill active={kindFilter === ""} onClick={() => setKindFilter("")} color={BONE}>all</Pill>
        {KINDS.map((k) => (
          <Pill key={k} active={kindFilter === k} onClick={() => setKindFilter(k)} color={KIND_COLOR[k] || TAUPE}>{(KIND_LABEL[k] || k).toLowerCase()}</Pill>
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
            nothing in this view. press FIND FEARS — the scan reads recent chats for &ldquo;I&rsquo;m afraid that&rdquo; / &ldquo;what if&rdquo; / &ldquo;my biggest fear is&rdquo; / &ldquo;I worry that&rdquo; patterns.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((f) => <Card key={f.id} f={f} onResolve={(m) => openResolve(f, m)} onPin={() => onPin(f)} onArchive={() => onArchive(f)} onDismiss={() => onDismiss(f)} onUnresolve={() => onUnresolve(f)} onDelete={() => onDelete(f)} />)}
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
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 4 }}>the feared event</div>
            <div style={{ fontSize: 14, color: BONE, fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 10, lineHeight: 1.5 }}>
              you feared: <span style={{ color: modeColor(resolveMode) }}>{resolveTarget.fear_text}</span>
            </div>
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 4 }}>kind</div>
            <div style={{ fontSize: 13, color: KIND_COLOR[resolveTarget.fear_kind] || TAUPE, marginBottom: 14, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {KIND_LABEL[resolveTarget.fear_kind] || resolveTarget.fear_kind}
              {resolveTarget.feared_subject && <span style={{ color: BONE, fontStyle: "italic", textTransform: "none", fontFamily: "Georgia, serif", letterSpacing: 0, marginLeft: 8 }}>(about {resolveTarget.feared_subject})</span>}
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

// THE NOVEL VISUALISATION — Fear-vs-Reality map.
//
// Top: a stacked bar showing the four resolution buckets across all
// resolved fears. Visual proof of how many feared events actually came
// against how many dissolved or displaced.
//
// Bottom: per-kind realisation rates sorted desc. Surfaces which fear
// flavour is most accurate (when this kind fires, take it seriously)
// vs which is most overrun (when this kind fires, the fear almost never
// realises — cognitive bandwidth lost).
function FearRealityMap({ stats }: { stats: Stats }) {
  const total = stats.realised + stats.partially_realised + stats.dissolved + stats.displaced;
  if (total === 0) return null;
  const pct = (n: number) => Math.round((n / total) * 100);

  let interpretation = "";
  if (stats.fear_realisation_rate >= 60) interpretation = `${stats.fear_realisation_rate}% of your articulated fears actually came true. when fear rises, take it seriously.`;
  else if (stats.fear_realisation_rate <= 25) interpretation = `only ${stats.fear_realisation_rate}% of your fears came true — you spend ${stats.fear_overrun_rate}% of your cognitive bandwidth on events that don't happen.`;
  else interpretation = `${stats.fear_realisation_rate}% realisation rate — fears are right around half the time. interpret each fear on its own evidence, not the headline rate.`;

  const kindEntries = Object.entries(stats.per_kind_rate)
    .filter(([, v]) => v.total >= 2)
    .sort((a, b) => b[1].rate - a[1].rate);

  return (
    <div style={{ background: `${LAVENDER}08`, border: `1px solid ${LAVENDER}33`, padding: "14px 16px", marginBottom: 16, borderRadius: 2 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", color: LAVENDER, textTransform: "uppercase", marginBottom: 12 }}>fears vs reality · the empirical record</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 6 }}>
        <ResCell color={SALMON} label="realised" count={stats.realised} pct={pct(stats.realised)} />
        <ResCell color={AMBER} label="partially" count={stats.partially_realised} pct={pct(stats.partially_realised)} />
        <ResCell color={SAGE} label="dissolved" count={stats.dissolved} pct={pct(stats.dissolved)} />
        <ResCell color={LAVENDER} label="displaced" count={stats.displaced} pct={pct(stats.displaced)} />
      </div>

      {kindEntries.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase", marginBottom: 8 }}>realisation rate by fear flavour</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {kindEntries.map(([kind, v]) => (
              <KindBar key={kind} kind={kind} rate={v.rate} total={v.total} />
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: BONE, marginTop: 14, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.6 }}>
        {interpretation}
        {stats.most_realised_kind && stats.most_realised_kind.total >= 3 && stats.most_realised_kind.rate >= 60 && (
          <> when <span style={{ color: KIND_COLOR[stats.most_realised_kind.kind] || TAUPE }}>{(KIND_LABEL[stats.most_realised_kind.kind] || stats.most_realised_kind.kind).toLowerCase()}</span> fires, it's been right {stats.most_realised_kind.rate}% of the time over {stats.most_realised_kind.total} resolved — your most accurate fear flavour.</>
        )}
        {stats.least_realised_kind && stats.least_realised_kind.total >= 3 && stats.least_realised_kind.rate <= 30 && (
          <> when <span style={{ color: SAGE }}>{(KIND_LABEL[stats.least_realised_kind.kind] || stats.least_realised_kind.kind).toLowerCase()}</span> fires, it's only realised {stats.least_realised_kind.rate}% of the time — the bandwidth-overrun flavour.</>
        )}
        {stats.most_common_open_kind && (
          <> currently the fear flavour bending the most behaviour is <span style={{ color: KIND_COLOR[stats.most_common_open_kind] || TAUPE }}>{(KIND_LABEL[stats.most_common_open_kind] || stats.most_common_open_kind).toLowerCase()}</span>.</>
        )}
      </div>
    </div>
  );
}

function KindBar({ kind, rate, total }: { kind: string; rate: number; total: number }) {
  const colour = KIND_COLOR[kind] || TAUPE;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 60px", gap: 8, alignItems: "center" }}>
      <div style={{ fontSize: 9, color: colour, letterSpacing: "0.15em", textTransform: "uppercase" }}>{(KIND_LABEL[kind] || kind).toLowerCase()}</div>
      <div style={{ background: `${colour}10`, border: `1px solid ${colour}33`, height: 14, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${rate}%`, height: "100%", background: colour, opacity: 0.7 }} />
      </div>
      <div style={{ fontSize: 10, color: BONE, fontFamily: "Georgia, serif" }}>{rate}% <span style={{ color: TAUPE }}>· n={total}</span></div>
    </div>
  );
}

function ResCell({ color, label, count, pct }: { color: string; label: string; count: number; pct: number }) {
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

function Card({ f, onResolve, onPin, onArchive, onDismiss, onUnresolve, onDelete }: {
  f: Fear;
  onResolve: (mode: ResolveMode) => void;
  onPin: () => void;
  onArchive: () => void;
  onDismiss: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
}) {
  const isOpen = f.status === "open";
  const isResolved = ["realised", "partially_realised", "dissolved", "displaced", "unresolved"].includes(f.status);
  const accent = isOpen ? KIND_COLOR[f.fear_kind] || TAUPE : STATUS_COLOR[f.status] || TAUPE;
  const archived = !!f.archived_at;

  return (
    <div style={{ borderLeft: `3px solid ${accent}`, background: archived ? "#0a0a0a55" : "#0a0a0a", padding: "14px 16px", borderRadius: "0 2px 2px 0", opacity: archived ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.18em", color: KIND_COLOR[f.fear_kind] || TAUPE, textTransform: "uppercase" }}>{KIND_LABEL[f.fear_kind] || f.fear_kind}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em" }}>{f.domain}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: TAUPE }}>feared {ymd(f.spoken_date)}</span>
        {f.pinned && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, color: LAVENDER }}>● pinned</span></>)}
        {!isOpen && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, padding: "1px 6px", border: `1px solid ${STATUS_COLOR[f.status] || TAUPE}55`, color: STATUS_COLOR[f.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", borderRadius: 2 }}>{STATUS_LABEL[f.status] || f.status}</span></>)}
        <div style={{ marginLeft: "auto" }}><ChargeMeter value={f.charge} /></div>
      </div>

      <div style={{ fontSize: 16, fontFamily: "Georgia, serif", fontStyle: "italic", color: BONE, marginBottom: 8, lineHeight: 1.45 }}>
        you feared: <span style={{ color: accent }}>{f.fear_text}</span>
        {f.feared_subject && <span style={{ color: TAUPE, fontStyle: "italic" }}> · about {f.feared_subject}</span>}
      </div>

      {f.resolution_note && isResolved && (
        <div style={{ background: `${STATUS_COLOR[f.status] || TAUPE}10`, border: `1px solid ${STATUS_COLOR[f.status] || TAUPE}55`, padding: "8px 12px", marginTop: 8, marginBottom: 12, borderRadius: 2 }}>
          <div style={{ fontSize: 10, color: STATUS_COLOR[f.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>
            {STATUS_LABEL[f.status]}
          </div>
          <div style={{ fontSize: 13, color: BONE, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>{f.resolution_note}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        {isOpen ? (
          <>
            <ActionButton color={SALMON} onClick={() => onResolve("realised")}>realised</ActionButton>
            <ActionButton color={AMBER} onClick={() => onResolve("partially_realised")}>partially realised</ActionButton>
            <ActionButton color={SAGE} onClick={() => onResolve("dissolved")}>dissolved</ActionButton>
            <ActionButton color={LAVENDER} onClick={() => onResolve("displaced")}>displaced</ActionButton>
            <ActionButton color={AMBER} onClick={() => onResolve("unresolved")}>still unfolding</ActionButton>
            <ActionButton color={TAUPE} onClick={onDismiss}>dismiss</ActionButton>
          </>
        ) : isResolved ? (
          <ActionButton color={TAUPE} onClick={onUnresolve}>unresolve</ActionButton>
        ) : null}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <ActionButton color={LAVENDER} onClick={onPin}>{f.pinned ? "unpin" : "pin"}</ActionButton>
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
