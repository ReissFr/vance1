"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ClaimKind = "am" | "value" | "refuse" | "becoming" | "aspire";
type EvidenceKind = "decision" | "standup" | "win" | "reflection" | "intention" | "checkin";
type Status =
  | "open"
  | "resolved_changed_mind"
  | "resolved_still_true"
  | "resolved_one_off"
  | "dismissed";

type Contradiction = {
  id: string;
  claim_id: string;
  claim_kind: ClaimKind;
  claim_text: string;
  evidence_kind: EvidenceKind;
  evidence_id: string;
  evidence_text: string;
  evidence_date: string;
  severity: number;
  note: string | null;
  status: Status;
  resolved_at: string | null;
  resolved_note: string | null;
  scan_window_days: number | null;
  created_at: string;
};

type StatusFilter = "open" | "resolved" | "dismissed" | "all";

const CLAIM_COLOR: Record<ClaimKind, string> = {
  am: "#e8e0d2",
  value: "#bfd4ee",
  refuse: "#f4a3a3",
  becoming: "#7affcb",
  aspire: "#c89bff",
};

const CLAIM_LABEL: Record<ClaimKind, string> = {
  am: "I am",
  value: "I value",
  refuse: "I refuse",
  becoming: "I'm becoming",
  aspire: "I aspire",
};

const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  decision: "Decision",
  standup: "Standup",
  win: "Win",
  reflection: "Reflection",
  intention: "Intention",
  checkin: "Check-in",
};

const EVIDENCE_HREF: Record<EvidenceKind, string> = {
  decision: "/decisions",
  standup: "/standup",
  win: "/wins",
  reflection: "/reflections",
  intention: "/intentions",
  checkin: "/checkins",
};

const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  resolved_changed_mind: "Changed my mind",
  resolved_still_true: "Still true · re-aligning",
  resolved_one_off: "One-off",
  dismissed: "Dismissed",
};

const STATUS_COLOR: Record<Status, string> = {
  open: "#f4a3a3",
  resolved_changed_mind: "#c89bff",
  resolved_still_true: "#7affcb",
  resolved_one_off: "#bfd4ee",
  dismissed: "#666",
};

export function BeliefContradictionsConsole() {
  const [rows, setRows] = useState<Contradiction[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [windowDays, setWindowDays] = useState<14 | 30 | 60 | 90>(60);
  const [maxPairs, setMaxPairs] = useState<number>(8);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/belief-contradictions?status=${statusFilter}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "load failed");
      setRows((j.contradictions ?? []) as Contradiction[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setScanNote(null);
    try {
      const r = await fetch("/api/belief-contradictions/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ window_days: windowDays, max: maxPairs }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "scan failed");
      const generated = (j.generated ?? []) as Contradiction[];
      const skipped = typeof j.skipped_existing === "number" ? j.skipped_existing : 0;
      if (generated.length === 0 && j.note) {
        setScanNote(j.note);
      } else {
        const skipNote = skipped > 0 ? ` · ${skipped} already open` : "";
        setScanNote(`scan complete · ${generated.length} new pair${generated.length === 1 ? "" : "s"}${skipNote}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "scan failed");
    } finally {
      setScanning(false);
    }
  }, [windowDays, maxPairs, load]);

  const updateStatus = useCallback(
    async (id: string, status: Status, note?: string) => {
      try {
        const r = await fetch(`/api/belief-contradictions/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status, note }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j?.error ?? "update failed");
        }
        setResolvingId(null);
        setResolveNote("");
        void load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "update failed");
      }
    },
    [load],
  );

  const onDelete = useCallback(
    async (id: string) => {
      setRows((prev) => prev.filter((r) => r.id !== id));
      try {
        await fetch(`/api/belief-contradictions/${id}`, { method: "DELETE" });
      } catch {
        void load();
      }
    },
    [load],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, Contradiction[]>();
    for (const r of rows) {
      const key = r.claim_id;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries()).sort(
      (a, b) =>
        Math.max(...b[1].map((x) => x.severity)) -
        Math.max(...a[1].map((x) => x.severity)),
    );
  }, [rows]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", fontSize: 26, color: "#e8e0d2" }}>
            Where what you said clashes with what you did
          </span>
          <span style={{ color: "#888", fontSize: 13 }}>
            {loading ? "loading…" : `${rows.length} pair${rows.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            padding: 12,
            border: "1px solid #2a2a2a",
            background: "#1a1a1a",
          }}
        >
          <span style={{ color: "#aaa", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" }}>
            scan window
          </span>
          {[14, 30, 60, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d as 14 | 30 | 60 | 90)}
              style={{
                padding: "3px 9px",
                background: windowDays === d ? "#e8e0d2" : "transparent",
                color: windowDays === d ? "#111" : "#aaa",
                border: "1px solid " + (windowDays === d ? "#e8e0d2" : "#333"),
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {d}d
            </button>
          ))}
          <span style={{ color: "#666", fontSize: 11, marginLeft: 6 }}>up to</span>
          <input
            type="number"
            min={1}
            max={20}
            value={maxPairs}
            onChange={(e) => setMaxPairs(Math.max(1, Math.min(20, Number(e.target.value) || 8)))}
            style={{ width: 50, padding: "3px 6px", background: "#0e0e0e", color: "#e8e0d2", border: "1px solid #333", fontSize: 12 }}
          />
          <span style={{ color: "#666", fontSize: 11 }}>pairs</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            disabled={scanning}
            onClick={scan}
            style={{
              padding: "5px 14px",
              background: scanning ? "#444" : "#f4a3a3",
              color: scanning ? "#888" : "#111",
              border: "1px solid #f4a3a3",
              fontSize: 12,
              cursor: scanning ? "wait" : "pointer",
            }}
          >
            {scanning ? "scanning…" : "Scan for clashes"}
          </button>
        </div>
        {scanNote ? <div style={{ color: "#9aa28e", fontSize: 12 }}>{scanNote}</div> : null}

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {(["open", "resolved", "dismissed", "all"] as StatusFilter[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              style={{
                padding: "3px 9px",
                background: statusFilter === s ? "#e8e0d2" : "transparent",
                color: statusFilter === s ? "#111" : "#aaa",
                border: "1px solid " + (statusFilter === s ? "#e8e0d2" : "#333"),
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      {error ? <div style={{ color: "#f4a3a3" }}>{error}</div> : null}

      {!loading && rows.length === 0 ? (
        <div
          style={{
            padding: 24,
            border: "1px dashed #2a2a2a",
            color: "#9aa28e",
            fontFamily: "var(--font-serif, Georgia, serif)",
            fontStyle: "italic",
            fontSize: 16,
          }}
        >
          {statusFilter === "open"
            ? "No open clashes. Run a scan and the brain will look for places your stated values are slipping against your actual behaviour."
            : statusFilter === "resolved"
              ? "Nothing resolved yet."
              : statusFilter === "dismissed"
                ? "Nothing dismissed."
                : "Empty."}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {grouped.map(([claimId, items]) => {
          const head = items[0];
          if (!head) return null;
          const claimColor = CLAIM_COLOR[head.claim_kind];
          return (
            <section key={claimId} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  paddingBottom: 6,
                  borderBottom: `1px solid ${claimColor}33`,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: 1,
                    color: claimColor,
                    textTransform: "uppercase",
                    border: `1px solid ${claimColor}`,
                    padding: "1px 6px",
                  }}
                >
                  {CLAIM_LABEL[head.claim_kind]}
                </span>
                <span style={{ fontFamily: "var(--font-serif, Georgia, serif)", fontStyle: "italic", color: "#e8e0d2", fontSize: 16 }}>
                  {head.claim_text}
                </span>
                <span style={{ fontSize: 11, color: "#666" }}>· {items.length} clash{items.length === 1 ? "" : "es"}</span>
              </div>

              {items.map((c) => (
                <PairCard
                  key={c.id}
                  c={c}
                  resolvingId={resolvingId}
                  resolveNote={resolveNote}
                  setResolvingId={setResolvingId}
                  setResolveNote={setResolveNote}
                  onResolve={(status) => updateStatus(c.id, status, resolveNote.trim() || undefined)}
                  onDelete={() => onDelete(c.id)}
                  onReopen={() => updateStatus(c.id, "open")}
                />
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PairCard({
  c,
  resolvingId,
  resolveNote,
  setResolvingId,
  setResolveNote,
  onResolve,
  onDelete,
  onReopen,
}: {
  c: Contradiction;
  resolvingId: string | null;
  resolveNote: string;
  setResolvingId: (id: string | null) => void;
  setResolveNote: (s: string) => void;
  onResolve: (status: Status) => void;
  onDelete: () => void;
  onReopen: () => void;
}) {
  const evColor = "#fbb86d";
  const isOpen = c.status === "open";
  const isResolving = resolvingId === c.id;
  const sevDots = "●".repeat(c.severity) + "○".repeat(5 - c.severity);
  const evHref = EVIDENCE_HREF[c.evidence_kind];
  return (
    <div
      style={{
        padding: 14,
        background: "#161616",
        border: "1px solid #232323",
        opacity: c.status === "dismissed" ? 0.55 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "#f4a3a3", letterSpacing: 1 }}>{sevDots}</span>
        <span style={{ fontSize: 11, color: "#666" }}>severity {c.severity}/5</span>
        <span style={{ fontSize: 11, color: "#444" }}>· detected {c.created_at.slice(0, 10)}</span>
        {!isOpen ? (
          <span
            style={{
              fontSize: 10,
              letterSpacing: 1,
              color: STATUS_COLOR[c.status],
              border: `1px solid ${STATUS_COLOR[c.status]}`,
              padding: "1px 6px",
              textTransform: "uppercase",
            }}
          >
            {STATUS_LABEL[c.status]}
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {isOpen ? (
          <button
            type="button"
            onClick={() => {
              setResolvingId(isResolving ? null : c.id);
              setResolveNote("");
            }}
            style={{
              background: "transparent",
              border: "1px solid #333",
              color: isResolving ? "#f4a3a3" : "#aaa",
              fontSize: 11,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            {isResolving ? "Cancel" : "Resolve"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onReopen}
            style={{ background: "transparent", border: "1px solid #333", color: "#aaa", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
          >
            Reopen
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          style={{ background: "transparent", border: "1px solid #333", color: "#a14040", fontSize: 11, padding: "2px 8px", cursor: "pointer" }}
        >
          Delete
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div
          style={{
            padding: 10,
            background: "#0e0e0e",
            borderLeft: `3px solid ${CLAIM_COLOR[c.claim_kind]}`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 10, color: CLAIM_COLOR[c.claim_kind], letterSpacing: 1, textTransform: "uppercase" }}>
            said · {CLAIM_LABEL[c.claim_kind]}
          </div>
          <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "#e8e0d2", fontSize: 14, lineHeight: 1.45 }}>
            {c.claim_text}
          </div>
        </div>

        <div
          style={{
            padding: 10,
            background: "#0e0e0e",
            borderLeft: `3px solid ${evColor}`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ fontSize: 10, color: evColor, letterSpacing: 1, textTransform: "uppercase", display: "flex", gap: 6 }}>
            <span>did · {EVIDENCE_LABEL[c.evidence_kind]}</span>
            <span style={{ color: "#666" }}>· {c.evidence_date}</span>
          </div>
          <div style={{ fontFamily: "var(--font-serif, Georgia, serif)", color: "#e8e0d2", fontSize: 14, lineHeight: 1.45 }}>
            {c.evidence_text}
          </div>
          <a
            href={evHref}
            style={{ fontSize: 10, color: "#666", marginTop: 2, textDecoration: "underline" }}
          >
            open in {EVIDENCE_LABEL[c.evidence_kind].toLowerCase()} log →
          </a>
        </div>
      </div>

      {c.note ? (
        <div
          style={{
            padding: "8px 12px",
            background: "#0e0e0e",
            borderLeft: "3px solid #9aa28e",
            color: "#cdcdcd",
            fontSize: 13,
            fontStyle: "italic",
            lineHeight: 1.5,
          }}
        >
          {c.note}
        </div>
      ) : null}

      {c.resolved_note ? (
        <div style={{ fontSize: 12, color: "#9aa28e" }}>
          <span style={{ color: "#666" }}>your note · </span>
          {c.resolved_note}
        </div>
      ) : null}

      {isResolving ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid #2a2a2a", background: "#0e0e0e" }}>
          <textarea
            value={resolveNote}
            onChange={(e) => setResolveNote(e.target.value)}
            placeholder="optional note · what made you decide which way it goes"
            style={{
              minHeight: 56,
              padding: 8,
              background: "#161616",
              color: "#e8e0d2",
              border: "1px solid #2a2a2a",
              fontSize: 13,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => onResolve("resolved_changed_mind")}
              style={{ padding: "4px 10px", background: "transparent", border: `1px solid ${STATUS_COLOR.resolved_changed_mind}`, color: STATUS_COLOR.resolved_changed_mind, fontSize: 11, cursor: "pointer" }}
            >
              I changed my mind
            </button>
            <button
              type="button"
              onClick={() => onResolve("resolved_still_true")}
              style={{ padding: "4px 10px", background: "transparent", border: `1px solid ${STATUS_COLOR.resolved_still_true}`, color: STATUS_COLOR.resolved_still_true, fontSize: 11, cursor: "pointer" }}
            >
              Still true · re-aligning
            </button>
            <button
              type="button"
              onClick={() => onResolve("resolved_one_off")}
              style={{ padding: "4px 10px", background: "transparent", border: `1px solid ${STATUS_COLOR.resolved_one_off}`, color: STATUS_COLOR.resolved_one_off, fontSize: 11, cursor: "pointer" }}
            >
              One-off slip
            </button>
            <button
              type="button"
              onClick={() => onResolve("dismissed")}
              style={{ padding: "4px 10px", background: "transparent", border: "1px solid #666", color: "#888", fontSize: 11, cursor: "pointer" }}
            >
              Not a real clash
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
