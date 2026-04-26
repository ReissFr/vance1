"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Snapshot = {
  vows?: Array<{ id: string; vow_text: string; weight: number; vow_age: string }>;
  shoulds?: Array<{ id: string; should_text: string; weight: number }>;
  imagined_futures?: Array<{ id: string; act_text: string; pull_kind: string; weight: number }>;
  thresholds_recent?: Array<{ id: string; threshold_text: string; charge: string; magnitude: number }>;
  themes?: string[];
  conversation_count?: number;
  captured_at?: string;
  date_window?: { from: string; to: string };
};

type Letter = {
  id: string;
  letter_text: string;
  direction: "to_future_self" | "to_past_self" | "to_younger_self";
  target_date: string;
  title: string | null;
  prompt_used: string | null;
  author_state_snapshot: Snapshot | null;
  target_state_snapshot: Snapshot | null;
  status: "scheduled" | "delivered" | "archived";
  delivered_at: string | null;
  pinned: boolean;
  delivery_channels: { whatsapp?: boolean; email?: boolean; web?: boolean } | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  scheduled: number;
  delivered: number;
  archived: number;
  to_future_self: number;
  to_past_self: number;
  to_younger_self: number;
  pinned: number;
  next_scheduled: { id: string; target_date: string } | null;
  most_recent_delivered: { id: string; delivered_at: string } | null;
};

const MINT = "#7affcb";
const AMBER = "#fbb86d";
const SAGE = "#9aa28e";
const PEACH = "#f4a8a8";
const LAVENDER = "#c9b3f4";
const BLUE = "#bfd4ee";
const TAUPE = "#bfb5a8";
const SALMON = "#f4577a";

function directionTint(d: Letter["direction"]): string {
  if (d === "to_future_self") return MINT;
  if (d === "to_past_self") return AMBER;
  return PEACH;
}

function directionLabel(d: Letter["direction"]): string {
  if (d === "to_future_self") return "to future self";
  if (d === "to_past_self") return "to past self";
  return "to younger self";
}

function pullKindTint(k: string): string {
  if (k === "seeking") return MINT;
  if (k === "escaping") return AMBER;
  if (k === "grieving") return PEACH;
  return SAGE;
}

function chargeTint(c: string): string {
  if (c === "growth") return MINT;
  if (c === "drift") return SALMON;
  return LAVENDER;
}

function vowAgeTint(a: string): string {
  if (a === "childhood") return SALMON;
  if (a === "adolescent") return PEACH;
  if (a === "early_adult") return AMBER;
  if (a === "adult") return MINT;
  if (a === "recent") return BLUE;
  return SAGE;
}

function formatDateUk(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function daysBetween(a: string, b: string): number {
  const ad = new Date(a.length === 10 ? `${a}T00:00:00Z` : a).getTime();
  const bd = new Date(b.length === 10 ? `${b}T00:00:00Z` : b).getTime();
  return Math.round((bd - ad) / (1000 * 60 * 60 * 24));
}

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function LettersConsole() {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"all" | Letter["direction"]>("all");
  const [status, setStatus] = useState<"active" | "scheduled" | "delivered" | "pinned" | "archived" | "all">("active");
  const [composeOpen, setComposeOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (direction !== "all") params.set("direction", direction);
      params.set("status", status);
      const res = await fetch(`/api/letters?${params.toString()}`);
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "list failed");
      setLetters(j.letters as Letter[]);
      setStats(j.stats as Stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "list failed");
    } finally {
      setLoading(false);
    }
  }, [direction, status]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const actOnLetter = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/letters/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      setError(j.error || "action failed");
      return;
    }
    void fetchList();
  };

  const deleteLetter = async (id: string) => {
    if (!confirm("Delete this letter? This cannot be undone.")) return;
    const res = await fetch(`/api/letters/${id}`, { method: "DELETE" });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      setError(j.error || "delete failed");
      return;
    }
    void fetchList();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "0 24px 64px" }}>
      <TopBar onCompose={() => setComposeOpen(true)} />

      {composeOpen && (
        <ComposeModal
          onClose={() => setComposeOpen(false)}
          onComposed={() => { setComposeOpen(false); void fetchList(); }}
        />
      )}

      <StatsGrid stats={stats} letters={letters} />

      <Filters
        direction={direction}
        setDirection={setDirection}
        status={status}
        setStatus={setStatus}
      />

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(244,87,122,0.10)", color: SALMON, border: `1px solid ${SALMON}40`, fontSize: 13 }}>{error}</div>
      )}

      {loading && letters.length === 0 ? (
        <div style={{ padding: 40, textAlign: "center", color: "#787a73" }}>Loading…</div>
      ) : letters.length === 0 ? (
        <EmptyState onCompose={() => setComposeOpen(true)} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {letters.map((l) => (
            <LetterCard
              key={l.id}
              letter={l}
              expanded={expanded.has(l.id)}
              onToggle={() => toggleExpand(l.id)}
              onAct={(body) => actOnLetter(l.id, body)}
              onDelete={() => deleteLetter(l.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TopBar({ onCompose }: { onCompose: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <div style={{ fontSize: 13, color: "#787a73", maxWidth: 580, lineHeight: 1.5 }}>
        Every letter you write here captures who you are when you write it. Letters to your past or younger self are also marked with who they were back then. Letters to your future self deliver on their date.
      </div>
      <button
        onClick={onCompose}
        style={{
          padding: "10px 20px",
          background: MINT,
          color: "#0a0a0a",
          border: "none",
          borderRadius: 8,
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
          letterSpacing: "0.02em",
        }}
      >
        Compose a letter
      </button>
    </div>
  );
}

function StatsGrid({ stats, letters }: { stats: Stats | null; letters: Letter[] }) {
  if (!stats) return null;
  const nextLetter = stats.next_scheduled
    ? letters.find((l) => l.id === stats.next_scheduled?.id)
    : null;
  const cells: Array<{ value: string | number; label: string; sub?: string; color: string }> = [
    {
      value: stats.scheduled,
      label: "scheduled",
      sub: nextLetter ? `next: ${formatDateUk(nextLetter.target_date)}` : "no upcoming",
      color: MINT,
    },
    {
      value: stats.to_past_self + stats.to_younger_self,
      label: "letters back in time",
      sub: "with inferred recipient state",
      color: AMBER,
    },
    {
      value: stats.delivered,
      label: "delivered",
      sub: stats.most_recent_delivered ? `latest: ${formatDateUk(stats.most_recent_delivered.delivered_at)}` : "none yet",
      color: SAGE,
    },
    {
      value: stats.pinned,
      label: "pinned",
      sub: "shortcuts",
      color: LAVENDER,
    },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
      {cells.map((c) => (
        <div
          key={c.label}
          style={{
            padding: "16px 18px",
            background: "rgba(255,255,255,0.02)",
            border: `1px solid ${c.color}30`,
            borderLeft: `3px solid ${c.color}`,
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 28, fontWeight: 600, color: c.color, lineHeight: 1, marginBottom: 6 }}>{c.value}</div>
          <div style={{ fontSize: 12, color: "#aeb1a8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{c.label}</div>
          {c.sub && <div style={{ fontSize: 11, color: "#787a73", marginTop: 4, fontStyle: "italic" }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function Filters({
  direction,
  setDirection,
  status,
  setStatus,
}: {
  direction: "all" | Letter["direction"];
  setDirection: (v: "all" | Letter["direction"]) => void;
  status: "active" | "scheduled" | "delivered" | "pinned" | "archived" | "all";
  setStatus: (v: "active" | "scheduled" | "delivered" | "pinned" | "archived" | "all") => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <FilterRow label="Direction">
        <Pill on={direction === "all"} onClick={() => setDirection("all")}>all</Pill>
        <Pill on={direction === "to_future_self"} onClick={() => setDirection("to_future_self")} color={MINT}>to future self</Pill>
        <Pill on={direction === "to_past_self"} onClick={() => setDirection("to_past_self")} color={AMBER}>to past self</Pill>
        <Pill on={direction === "to_younger_self"} onClick={() => setDirection("to_younger_self")} color={PEACH}>to younger self</Pill>
      </FilterRow>
      <FilterRow label="Status">
        <Pill on={status === "active"} onClick={() => setStatus("active")}>active</Pill>
        <Pill on={status === "scheduled"} onClick={() => setStatus("scheduled")} color={MINT}>scheduled</Pill>
        <Pill on={status === "delivered"} onClick={() => setStatus("delivered")} color={SAGE}>delivered</Pill>
        <Pill on={status === "pinned"} onClick={() => setStatus("pinned")} color={LAVENDER}>pinned</Pill>
        <Pill on={status === "archived"} onClick={() => setStatus("archived")} color={TAUPE}>archived</Pill>
        <Pill on={status === "all"} onClick={() => setStatus("all")}>all</Pill>
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ fontSize: 11, color: "#787a73", textTransform: "uppercase", letterSpacing: "0.06em", minWidth: 80 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Pill({
  children,
  on,
  onClick,
  color,
}: {
  children: React.ReactNode;
  on: boolean;
  onClick: () => void;
  color?: string;
}) {
  const c = color ?? "#aeb1a8";
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 11px",
        borderRadius: 999,
        background: on ? `${c}25` : "transparent",
        border: `1px solid ${on ? c : "#3a3c36"}`,
        color: on ? c : "#aeb1a8",
        fontSize: 12,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ onCompose }: { onCompose: () => void }) {
  return (
    <div style={{ padding: "60px 24px", textAlign: "center", border: "1px dashed #3a3c36", borderRadius: 12, background: "rgba(255,255,255,0.01)" }}>
      <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 22, color: "#cfd1c8", marginBottom: 8 }}>
        no letters yet
      </div>
      <div style={{ fontSize: 13, color: "#787a73", maxWidth: 420, margin: "0 auto 20px", lineHeight: 1.5 }}>
        Write a letter to who you'll be in five years, or to who you were ten years ago. Each one carries a state-vector snapshot so you can read it later with proof of who you were.
      </div>
      <button
        onClick={onCompose}
        style={{ padding: "10px 24px", background: MINT, color: "#0a0a0a", border: "none", borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: "pointer" }}
      >
        Compose your first letter
      </button>
    </div>
  );
}

function LetterCard({
  letter,
  expanded,
  onToggle,
  onAct,
  onDelete,
}: {
  letter: Letter;
  expanded: boolean;
  onToggle: () => void;
  onAct: (body: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const tint = directionTint(letter.direction);
  const today = todayIso();
  const isUpcoming = letter.status === "scheduled" && letter.direction === "to_future_self" && letter.target_date >= today;
  const daysUntil = isUpcoming ? daysBetween(today, letter.target_date) : 0;

  return (
    <div
      style={{
        padding: "20px 22px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid #2a2c26",
        borderLeft: `3px solid ${tint}`,
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: tint, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              {directionLabel(letter.direction)}
            </span>
            <span style={{ fontSize: 11, color: "#787a73" }}>·</span>
            <span style={{ fontSize: 11, color: "#aeb1a8" }}>
              {letter.direction === "to_future_self"
                ? `for ${formatDateUk(letter.target_date)}`
                : `to who you were on ${formatDateUk(letter.target_date)}`}
            </span>
            {isUpcoming && daysUntil > 0 && (
              <span style={{ fontSize: 11, color: MINT, padding: "2px 8px", borderRadius: 999, background: `${MINT}15`, border: `1px solid ${MINT}40` }}>
                in {daysUntil} {daysUntil === 1 ? "day" : "days"}
              </span>
            )}
            {letter.status === "delivered" && (
              <span style={{ fontSize: 11, color: AMBER, padding: "2px 8px", borderRadius: 999, background: `${AMBER}15`, border: `1px solid ${AMBER}40`, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                delivered
              </span>
            )}
            {letter.status === "archived" && (
              <span style={{ fontSize: 11, color: TAUPE, padding: "2px 8px", borderRadius: 999, background: `${TAUPE}15`, border: `1px solid ${TAUPE}40`, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                archived
              </span>
            )}
            {letter.pinned && (
              <span style={{ fontSize: 11, color: LAVENDER }}>· pinned</span>
            )}
          </div>
          {letter.title && (
            <div style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 22, color: "#e6e8de", lineHeight: 1.3, marginTop: 4 }}>
              {letter.title}
            </div>
          )}
          {letter.prompt_used && (
            <div style={{ fontSize: 12, color: "#787a73", fontStyle: "italic", marginTop: 4 }}>
              prompt: "{letter.prompt_used}"
            </div>
          )}
        </div>
      </div>

      <div
        onClick={onToggle}
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 15,
          color: "#cfd1c8",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          cursor: "pointer",
          padding: "8px 12px",
          background: "rgba(255,255,255,0.015)",
          borderLeft: `2px solid ${tint}40`,
          borderRadius: 4,
          maxHeight: expanded ? "none" : 140,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {letter.letter_text}
        {!expanded && letter.letter_text.length > 380 && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 60, background: "linear-gradient(to bottom, transparent, rgba(20,20,20,0.95))", pointerEvents: "none" }} />
        )}
      </div>
      {letter.letter_text.length > 380 && (
        <button
          onClick={onToggle}
          style={{ marginTop: 6, fontSize: 11, color: "#787a73", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          {expanded ? "show less" : "read full letter"}
        </button>
      )}

      <div style={{ display: "grid", gridTemplateColumns: letter.target_state_snapshot ? "1fr 1fr" : "1fr", gap: 12, marginTop: 16 }}>
        {letter.author_state_snapshot && (
          <SnapshotPanel
            title={letter.direction === "to_future_self" ? "who you were when you wrote this" : "who you are now writing"}
            snapshot={letter.author_state_snapshot}
            tint={tint}
          />
        )}
        {letter.target_state_snapshot && (
          <SnapshotPanel
            title={`who you were on ${formatDateUk(letter.target_date)}`}
            snapshot={letter.target_state_snapshot}
            tint={letter.direction === "to_past_self" ? AMBER : PEACH}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {letter.pinned ? (
          <ActionBtn onClick={() => onAct({ mode: "unpin" })}>unpin</ActionBtn>
        ) : (
          <ActionBtn onClick={() => onAct({ mode: "pin" })} color={LAVENDER}>pin</ActionBtn>
        )}
        {letter.status === "scheduled" && (
          <ActionBtn onClick={() => onAct({ mode: "deliver_now" })} color={AMBER}>deliver now</ActionBtn>
        )}
        {letter.status === "archived" ? (
          <ActionBtn onClick={() => onAct({ mode: "restore" })}>restore</ActionBtn>
        ) : (
          <ActionBtn onClick={() => onAct({ mode: "archive" })}>archive</ActionBtn>
        )}
        <ActionBtn onClick={onDelete} color={SALMON}>delete</ActionBtn>
      </div>
    </div>
  );
}

function SnapshotPanel({
  title,
  snapshot,
  tint,
}: {
  title: string;
  snapshot: Snapshot;
  tint: string;
}) {
  const empty =
    !snapshot.vows?.length &&
    !snapshot.shoulds?.length &&
    !snapshot.imagined_futures?.length &&
    !snapshot.thresholds_recent?.length &&
    !snapshot.themes?.length;

  return (
    <div
      style={{
        padding: "12px 14px",
        borderLeft: `2px solid ${tint}80`,
        borderRadius: 4,
        background: `${tint}08`,
      }}
    >
      <div style={{ fontSize: 10, color: tint, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontWeight: 600 }}>
        {title}
      </div>
      {empty && (
        <div style={{ fontSize: 12, color: "#787a73", fontStyle: "italic" }}>no signal — chats too sparse</div>
      )}
      {snapshot.vows && snapshot.vows.length > 0 && (
        <SnapshotSection label="active vows">
          {snapshot.vows.slice(0, 5).map((v) => (
            <div key={v.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: vowAgeTint(v.vow_age), textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 70 }}>{v.vow_age}</span>
              <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 12, color: "#cfd1c8" }}>"{v.vow_text}"</span>
            </div>
          ))}
        </SnapshotSection>
      )}
      {snapshot.imagined_futures && snapshot.imagined_futures.length > 0 && (
        <SnapshotSection label="futures imagined">
          {snapshot.imagined_futures.slice(0, 4).map((f) => (
            <div key={f.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: pullKindTint(f.pull_kind), textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 70 }}>{f.pull_kind}</span>
              <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 12, color: "#cfd1c8" }}>"{f.act_text}"</span>
            </div>
          ))}
        </SnapshotSection>
      )}
      {snapshot.thresholds_recent && snapshot.thresholds_recent.length > 0 && (
        <SnapshotSection label="thresholds recently crossed">
          {snapshot.thresholds_recent.slice(0, 4).map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: chargeTint(t.charge), textTransform: "uppercase", letterSpacing: "0.05em", minWidth: 70 }}>{t.charge}</span>
              <span style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 12, color: "#cfd1c8" }}>"{t.threshold_text}"</span>
            </div>
          ))}
        </SnapshotSection>
      )}
      {snapshot.shoulds && snapshot.shoulds.length > 0 && (
        <SnapshotSection label="shoulds carried">
          {snapshot.shoulds.slice(0, 4).map((s) => (
            <div key={s.id} style={{ fontFamily: "Georgia, serif", fontStyle: "italic", fontSize: 12, color: "#aeb1a8" }}>
              "{s.should_text}"
            </div>
          ))}
        </SnapshotSection>
      )}
      {snapshot.themes && snapshot.themes.length > 0 && (
        <SnapshotSection label="themes">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {snapshot.themes.map((t) => (
              <span key={t} style={{ fontSize: 11, color: "#cfd1c8", padding: "2px 8px", background: `${tint}15`, borderRadius: 999, border: `1px solid ${tint}30` }}>
                {t}
              </span>
            ))}
          </div>
        </SnapshotSection>
      )}
      {typeof snapshot.conversation_count === "number" && snapshot.conversation_count > 0 && (
        <div style={{ fontSize: 11, color: "#787a73", marginTop: 8, fontStyle: "italic" }}>
          {snapshot.conversation_count} {snapshot.conversation_count === 1 ? "conversation" : "conversations"}
          {snapshot.date_window && ` between ${formatDateUk(snapshot.date_window.from)} and ${formatDateUk(snapshot.date_window.to)}`}
        </div>
      )}
    </div>
  );
}

function SnapshotSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#787a73", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>{children}</div>
    </div>
  );
}

function ActionBtn({
  children,
  onClick,
  color,
}: {
  children: React.ReactNode;
  onClick: () => void;
  color?: string;
}) {
  const c = color ?? "#aeb1a8";
  return (
    <button
      onClick={onClick}
      style={{
        padding: "7px 14px",
        background: "transparent",
        color: c,
        border: `1px solid ${c}50`,
        borderRadius: 6,
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function ComposeModal({ onClose, onComposed }: { onClose: () => void; onComposed: () => void }) {
  const [direction, setDirection] = useState<Letter["direction"]>("to_future_self");
  const [targetDate, setTargetDate] = useState<string>(() => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [title, setTitle] = useState("");
  const [promptUsed, setPromptUsed] = useState("");
  const [letterText, setLetterText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // when direction switches, set sensible default target_date
  const onDirectionChange = (d: Letter["direction"]) => {
    setDirection(d);
    const today = new Date();
    if (d === "to_future_self") {
      const t = new Date(today);
      t.setUTCFullYear(t.getUTCFullYear() + 1);
      setTargetDate(t.toISOString().slice(0, 10));
    } else if (d === "to_past_self") {
      const t = new Date(today);
      t.setUTCFullYear(t.getUTCFullYear() - 1);
      setTargetDate(t.toISOString().slice(0, 10));
    } else {
      const t = new Date(today);
      t.setUTCFullYear(t.getUTCFullYear() - 10);
      setTargetDate(t.toISOString().slice(0, 10));
    }
  };

  const charCount = letterText.length;
  const valid = charCount >= 50 && charCount <= 8000 && /^\d{4}-\d{2}-\d{2}$/.test(targetDate);

  const submit = async () => {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/letters/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          letter_text: letterText,
          direction,
          target_date: targetDate,
          title: title.trim() || undefined,
          prompt_used: promptUsed.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "compose failed");
      onComposed();
    } catch (e) {
      setError(e instanceof Error ? e.message : "compose failed");
    } finally {
      setSubmitting(false);
    }
  };

  const directionExplanation = useMemo(() => {
    if (direction === "to_future_self") return "Will be delivered to you on the target date. The state-vector snapshot of who you are right now will arrive with the letter.";
    if (direction === "to_past_self") return "Addressed to who you were on this date in the past. The system will reconstruct that earlier you from chat history (vows, shoulds, futures imagined, themes) and store the snapshot alongside the letter.";
    return "Addressed to a much younger you. The system will reconstruct that earlier you from chat history (where available) and store the snapshot alongside the letter.";
  }, [direction]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: 24, overflow: "auto" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 700,
          background: "#0e0f0c",
          border: "1px solid #2a2c26",
          borderRadius: 12,
          padding: 24,
          marginTop: 40,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: "#e6e8de" }}>Compose a letter</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#787a73", fontSize: 20, cursor: "pointer", padding: 0 }}>×</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label>direction</Label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill on={direction === "to_future_self"} onClick={() => onDirectionChange("to_future_self")} color={MINT}>to future self</Pill>
            <Pill on={direction === "to_past_self"} onClick={() => onDirectionChange("to_past_self")} color={AMBER}>to past self</Pill>
            <Pill on={direction === "to_younger_self"} onClick={() => onDirectionChange("to_younger_self")} color={PEACH}>to younger self</Pill>
          </div>
          <div style={{ fontSize: 12, color: "#787a73", fontStyle: "italic", marginTop: 4 }}>
            {directionExplanation}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label>{direction === "to_future_self" ? "deliver on" : "addressed to who you were on"}</Label>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            max={direction === "to_future_self" ? undefined : todayIso()}
            min={direction === "to_future_self" ? todayIso() : undefined}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label>title <span style={{ color: "#787a73", fontWeight: 400 }}>(optional)</span></Label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="a title for this letter"
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label>the prompt or question you're answering <span style={{ color: "#787a73", fontWeight: 400 }}>(optional)</span></Label>
          <input
            type="text"
            value={promptUsed}
            onChange={(e) => setPromptUsed(e.target.value)}
            maxLength={240}
            placeholder="e.g. what would I want her to know?"
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Label>letter</Label>
          <textarea
            value={letterText}
            onChange={(e) => setLetterText(e.target.value)}
            placeholder="dear me…"
            rows={12}
            maxLength={8000}
            style={{ ...inputStyle, fontFamily: "Georgia, serif", fontSize: 15, lineHeight: 1.6, resize: "vertical", minHeight: 220 }}
          />
          <div style={{ fontSize: 11, color: charCount < 50 ? SALMON : charCount > 7800 ? AMBER : "#787a73", textAlign: "right" }}>
            {charCount} / 8000 {charCount < 50 && `· ${50 - charCount} more characters needed`}
          </div>
        </div>

        {error && (
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(244,87,122,0.10)", color: SALMON, border: `1px solid ${SALMON}40`, fontSize: 13 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} disabled={submitting} style={{ padding: "10px 20px", background: "transparent", color: "#aeb1a8", border: "1px solid #3a3c36", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>cancel</button>
          <button
            onClick={submit}
            disabled={!valid || submitting}
            style={{
              padding: "10px 20px",
              background: valid ? MINT : "#3a3c36",
              color: valid ? "#0a0a0a" : "#787a73",
              border: "none",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 13,
              cursor: valid && !submitting ? "pointer" : "not-allowed",
            }}
          >
            {submitting ? "writing…" : "send letter across time"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: "#aeb1a8", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid #3a3c36",
  borderRadius: 8,
  color: "#e6e8de",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
};
