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

type PermissionSlip = {
  id: string;
  scan_id: string | null;
  forbidden_action: string;
  signer: string;
  authority_text: string | null;
  domain: string;
  charge: number;
  recency: string;
  confidence: number;
  spoken_date: string;
  spoken_message_id: string;
  conversation_id: string | null;
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
  signed_by_self: number;
  re_signed: number;
  refused: number;
  dismissed: number;
  pinned: number;
  load_bearing_open: number;
  open_unsigned: number;
  open_external_signer: number;
  open_self_signed: number;
  signer_counts: Record<string, number>;
  open_signer_counts: Record<string, number>;
  domain_counts: Record<string, number>;
  biggest_open: null | { id: string; forbidden_action: string; charge: number; signer: string };
  most_common_signer: null | { signer: string; count: number };
  most_common_open_signer: null | { signer: string; count: number };
};

const SIGNER_COLOR: Record<string, string> = {
  self: MINT,
  parent: SALMON,
  partner: PEACH,
  peers: LAVENDER,
  society: BLUE,
  employer: AMBER,
  profession: SAGE,
  circumstance: TAUPE,
  unknown: TAUPE,
};

const SIGNER_LABEL: Record<string, string> = {
  self: "SELF",
  parent: "PARENT",
  partner: "PARTNER",
  peers: "PEERS",
  society: "SOCIETY",
  employer: "EMPLOYER",
  profession: "PROFESSION",
  circumstance: "CIRCUMSTANCE",
  unknown: "UNKNOWN",
};

const STATUS_COLOR: Record<string, string> = {
  open: SALMON,
  signed_by_self: MINT,
  re_signed: AMBER,
  refused: SALMON,
  dismissed: TAUPE,
};

const STATUS_LABEL: Record<string, string> = {
  open: "OPEN",
  signed_by_self: "SIGNED BY SELF",
  re_signed: "RE-SIGNED",
  refused: "REFUSED",
  dismissed: "DISMISSED",
};

const STATUS_BLURB: Record<string, string> = {
  signed_by_self: "you sign your own permission slip — the assumption that someone else needs to grant is gone",
  re_signed: "the constraint is legitimate; accepted with eyes open. name the real reason it holds",
  refused: "the slip isn't real / the authority is illegitimate. name what makes it so",
};

const SIGNERS = ["self", "parent", "partner", "peers", "society", "employer", "profession", "circumstance", "unknown"];
const DOMAINS = ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"];

type ResolveMode = "sign_self" | "re_sign" | "refuse" | null;

function ymd(date: string): string {
  return date.slice(0, 10);
}

export function PermissionSlipsConsole() {
  const [rows, setRows] = useState<PermissionSlip[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [windowDays, setWindowDays] = useState(180);

  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [signerFilter, setSignerFilter] = useState<string>("");
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [minCharge, setMinCharge] = useState<number>(1);

  const [resolveTarget, setResolveTarget] = useState<PermissionSlip | null>(null);
  const [resolveMode, setResolveMode] = useState<ResolveMode>(null);
  const [resolveNote, setResolveNote] = useState("");

  const fetchRows = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
    if (signerFilter) params.set("signer", signerFilter);
    if (domainFilter) params.set("domain", domainFilter);
    if (minCharge > 1) params.set("min_charge", String(minCharge));
    params.set("limit", "200");
    const r = await fetch(`/api/permission-slips?${params.toString()}`);
    const j = await r.json();
    setRows(j.permission_slips ?? []);
    setStats(j.stats ?? null);
    setLoading(false);
  }, [statusFilter, signerFilter, domainFilter, minCharge]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await fetch("/api/permission-slips/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(j.error || "scan failed");
      } else if ((j.inserted ?? 0) === 0) {
        alert(j.message || "no permission-slips detected — try a wider window");
      }
    } finally {
      setScanning(false);
      fetchRows();
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/permission-slips/${id}`, {
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
    if (note.length < 4) { alert("needs a sentence — at least 4 characters"); return; }
    const ok = await patch(resolveTarget.id, { mode: resolveMode, resolution_note: note });
    if (ok) {
      setResolveTarget(null);
      setResolveMode(null);
      setResolveNote("");
      fetchRows();
    }
  };

  const onPin = async (p: PermissionSlip) => { if (await patch(p.id, { mode: p.pinned ? "unpin" : "pin" })) fetchRows(); };
  const onArchive = async (p: PermissionSlip) => { if (await patch(p.id, { mode: p.archived_at ? "restore" : "archive" })) fetchRows(); };
  const onDismiss = async (p: PermissionSlip) => { if (await patch(p.id, { mode: "dismiss" })) fetchRows(); };
  const onUnresolve = async (p: PermissionSlip) => { if (await patch(p.id, { mode: "unresolve" })) fetchRows(); };
  const onDelete = async (p: PermissionSlip) => {
    if (!confirm("Delete this permission-slip?")) return;
    const r = await fetch(`/api/permission-slips/${p.id}`, { method: "DELETE" });
    if (r.ok) fetchRows();
  };

  const openResolve = (p: PermissionSlip, mode: ResolveMode) => {
    setResolveTarget(p);
    setResolveMode(mode);
    setResolveNote("");
  };

  const placeholder = useMemo(() => {
    if (resolveMode === "sign_self") return "what's the permission you're granting yourself?";
    if (resolveMode === "re_sign") return "what's the legitimate reason this constraint holds?";
    if (resolveMode === "refuse") return "what makes this slip not real / the authority illegitimate?";
    return "";
  }, [resolveMode]);

  return (
    <div style={{ padding: "16px 20px 80px", color: BONE, fontFamily: "ui-sans-serif, system-ui" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 14, borderBottom: `1px solid ${TAUPE}33` }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", color: TAUPE, textTransform: "uppercase" }}>the things you refuse yourself</div>
          <div style={{ fontSize: 13, color: BONE, marginTop: 4, fontStyle: "italic", fontFamily: "Georgia, serif" }}>
            every &ldquo;i can&apos;t&rdquo; has a signer. ask who&apos;s actually holding the pen.
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
          {scanning ? "scanning..." : "Find permission-slips"}
        </button>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="open" value={stats.open} sub={stats.load_bearing_open > 0 ? `${stats.load_bearing_open} load-bearing` : "unsigned"} color={SALMON} />
          <StatCard label="external signer" value={stats.open_external_signer} sub="open slips with someone else holding the pen" color={AMBER} />
          <StatCard label="self-signed" value={stats.signed_by_self} sub="permission you've granted yourself" color={MINT} />
          <StatCard label="refused" value={stats.refused} sub="authorities you rejected" color={LAVENDER} />
        </div>
      )}

      {stats && stats.open > 0 && (
        <SignerBreakdown counts={stats.open_signer_counts} total={stats.open} />
      )}

      <FilterRow label="status">
        {["open", "signed_by_self", "re_signed", "refused", "dismissed", "pinned", "all"].map((s) => (
          <Pill key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)} color={STATUS_COLOR[s] || (s === "pinned" ? LAVENDER : TAUPE)}>{s.replace(/_/g, " ")}</Pill>
        ))}
      </FilterRow>

      <FilterRow label="signer">
        <Pill active={signerFilter === ""} onClick={() => setSignerFilter("")} color={BONE}>all</Pill>
        {SIGNERS.map((s) => (
          <Pill key={s} active={signerFilter === s} onClick={() => setSignerFilter(s)} color={SIGNER_COLOR[s] || TAUPE}>{s}</Pill>
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
            no permission-slips in this view. press FIND PERMISSION-SLIPS — the scan reads recent chats for &ldquo;i can&apos;t&rdquo; / &ldquo;i&apos;m not allowed&rdquo; / &ldquo;it&apos;s not for me&rdquo; patterns.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {rows.map((p) => <Card key={p.id} p={p} onResolve={(m) => openResolve(p, m)} onPin={() => onPin(p)} onArchive={() => onArchive(p)} onDismiss={() => onDismiss(p)} onUnresolve={() => onUnresolve(p)} onDelete={() => onDelete(p)} />)}
          </div>
        )}
      </div>

      {resolveTarget && resolveMode && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={() => { setResolveTarget(null); setResolveMode(null); setResolveNote(""); }}>
          <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: "100%", background: "#0a0a0a", border: `2px solid ${resolveMode === "sign_self" ? MINT : resolveMode === "re_sign" ? AMBER : SALMON}`, padding: 24, borderRadius: 4 }}>
            <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: resolveMode === "sign_self" ? MINT : resolveMode === "re_sign" ? AMBER : SALMON, marginBottom: 6 }}>
              {resolveMode === "sign_self" ? "SIGN IT YOURSELF" : resolveMode === "re_sign" ? "RE-SIGN" : "REFUSE"}
            </div>
            <div style={{ fontSize: 13, fontStyle: "italic", color: BONE, marginBottom: 14, fontFamily: "Georgia, serif" }}>
              {resolveMode === "sign_self" ? STATUS_BLURB.signed_by_self : resolveMode === "re_sign" ? STATUS_BLURB.re_signed : STATUS_BLURB.refused}
            </div>
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 4 }}>the slip</div>
            <div style={{ fontSize: 14, color: BONE, fontFamily: "Georgia, serif", fontStyle: "italic", marginBottom: 10, lineHeight: 1.5 }}>
              you can&apos;t <span style={{ color: SALMON }}>{resolveTarget.forbidden_action}</span>
            </div>
            <div style={{ fontSize: 11, color: TAUPE, marginBottom: 4 }}>signed by</div>
            <div style={{ fontSize: 13, color: SIGNER_COLOR[resolveTarget.signer] || TAUPE, marginBottom: 14, letterSpacing: "0.15em", textTransform: "uppercase" }}>
              {SIGNER_LABEL[resolveTarget.signer] || resolveTarget.signer}
              {resolveTarget.authority_text && <span style={{ color: BONE, fontStyle: "italic", textTransform: "none", fontFamily: "Georgia, serif", letterSpacing: 0, marginLeft: 8 }}>({resolveTarget.authority_text})</span>}
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
              <button onClick={submitResolve} style={{ background: resolveMode === "sign_self" ? MINT : resolveMode === "re_sign" ? AMBER : SALMON, color: "#0a0a0a", border: "none", padding: "8px 14px", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", borderRadius: 2, fontWeight: 600 }}>confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SignerBreakdown({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0 || total === 0) return null;
  const top = entries[0];
  if (!top) return null;
  return (
    <div style={{ background: `${LAVENDER}08`, border: `1px solid ${LAVENDER}33`, padding: "12px 14px", marginBottom: 16, borderRadius: 2 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.18em", color: LAVENDER, textTransform: "uppercase", marginBottom: 8 }}>who&apos;s holding the pen</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map(([signer, count]) => {
          const pct = Math.round((count / total) * 100);
          return (
            <div key={signer} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ minWidth: 110, fontSize: 10, color: SIGNER_COLOR[signer] || TAUPE, letterSpacing: "0.15em", textTransform: "uppercase" }}>{SIGNER_LABEL[signer] || signer}</div>
              <div style={{ flex: 1, height: 8, background: `${TAUPE}22`, borderRadius: 1, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: SIGNER_COLOR[signer] || TAUPE }} />
              </div>
              <div style={{ minWidth: 64, fontSize: 10, color: TAUPE, textAlign: "right" }}>{count} · {pct}%</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: BONE, marginTop: 10, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>
        most of your open slips are signed by <span style={{ color: SIGNER_COLOR[top[0]] || TAUPE }}>{(SIGNER_LABEL[top[0]] || top[0]).toLowerCase()}</span>. is that authority you actually answer to?
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
  p: PermissionSlip;
  onResolve: (mode: ResolveMode) => void;
  onPin: () => void;
  onArchive: () => void;
  onDismiss: () => void;
  onUnresolve: () => void;
  onDelete: () => void;
}) {
  const isOpen = p.status === "open";
  const isResolved = ["signed_by_self", "re_signed", "refused"].includes(p.status);
  const accent = isOpen ? SIGNER_COLOR[p.signer] || TAUPE : STATUS_COLOR[p.status] || TAUPE;
  const archived = !!p.archived_at;
  return (
    <div style={{ borderLeft: `3px solid ${accent}`, background: archived ? "#0a0a0a55" : "#0a0a0a", padding: "14px 16px", borderRadius: "0 2px 2px 0", opacity: archived ? 0.6 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 10, letterSpacing: "0.18em", color: SIGNER_COLOR[p.signer] || TAUPE, textTransform: "uppercase" }}>{SIGNER_LABEL[p.signer] || p.signer}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: BLUE, textTransform: "uppercase", letterSpacing: "0.1em" }}>{p.domain}</span>
        <span style={{ fontSize: 10, color: TAUPE }}>·</span>
        <span style={{ fontSize: 10, color: TAUPE }}>{ymd(p.spoken_date)}</span>
        {p.pinned && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, color: LAVENDER }}>● pinned</span></>)}
        {!isOpen && (<><span style={{ fontSize: 10, color: TAUPE }}>·</span><span style={{ fontSize: 10, padding: "1px 6px", border: `1px solid ${STATUS_COLOR[p.status] || TAUPE}55`, color: STATUS_COLOR[p.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", borderRadius: 2 }}>{STATUS_LABEL[p.status] || p.status}</span></>)}
        <div style={{ marginLeft: "auto" }}><ChargeMeter value={p.charge} /></div>
      </div>

      <div style={{ fontSize: 16, fontFamily: "Georgia, serif", fontStyle: "italic", color: BONE, marginBottom: 8, lineHeight: 1.45 }}>
        you can&apos;t <span style={{ color: accent }}>{p.forbidden_action}</span>
      </div>

      {p.authority_text && (
        <div style={{ fontSize: 11, color: TAUPE, marginBottom: 12, letterSpacing: "0.05em" }}>
          authority — <span style={{ color: BONE, fontStyle: "italic", fontFamily: "Georgia, serif" }}>{p.authority_text}</span>
        </div>
      )}

      {p.resolution_note && isResolved && (
        <div style={{ background: `${STATUS_COLOR[p.status] || TAUPE}10`, border: `1px solid ${STATUS_COLOR[p.status] || TAUPE}55`, padding: "8px 12px", marginTop: 8, marginBottom: 12, borderRadius: 2 }}>
          <div style={{ fontSize: 10, color: STATUS_COLOR[p.status] || TAUPE, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 4 }}>{STATUS_LABEL[p.status]} — your reckoning</div>
          <div style={{ fontSize: 13, color: BONE, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.5 }}>{p.resolution_note}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        {isOpen ? (
          <>
            <ActionButton color={MINT} onClick={() => onResolve("sign_self")}>sign it yourself</ActionButton>
            <ActionButton color={AMBER} onClick={() => onResolve("re_sign")}>re-sign</ActionButton>
            <ActionButton color={SALMON} onClick={() => onResolve("refuse")}>refuse</ActionButton>
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
