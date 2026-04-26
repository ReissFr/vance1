"use client";

import { useCallback, useEffect, useState } from "react";

type Direction = "outbound" | "inbound";
type Status = "open" | "done" | "overdue" | "cancelled";

interface Commitment {
  id: string;
  direction: Direction;
  other_party: string;
  other_party_email: string | null;
  commitment_text: string;
  deadline: string | null;
  status: Status;
  source_email_id: string | null;
  source_email_subject: string | null;
  source_kind: "email" | "meeting" | "manual" | null;
  source_meeting_id: string | null;
  source_meeting_title: string | null;
  confidence: number | null;
  user_confirmed: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const STATUS_COLOR: Record<Status, string> = {
  open: "#7a8fff",
  overdue: "#ff6b6b",
  done: "#7affcb",
  cancelled: "#a5a5a5",
};

const DIRECTION_LABEL: Record<Direction, string> = {
  outbound: "You owe",
  inbound: "They owe",
};

function escapeCsv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(rows: Commitment[]) {
  const header = [
    "direction",
    "other_party",
    "other_party_email",
    "commitment_text",
    "deadline",
    "status",
    "confidence",
    "user_confirmed",
    "source_kind",
    "source_label",
    "notes",
    "created_at",
    "updated_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const sourceLabel =
      r.source_kind === "meeting"
        ? r.source_meeting_title ?? ""
        : r.source_email_subject ?? "";
    lines.push(
      [
        r.direction,
        r.other_party,
        r.other_party_email ?? "",
        r.commitment_text,
        r.deadline ?? "",
        r.status,
        r.confidence ?? "",
        r.user_confirmed ? "1" : "0",
        r.source_kind ?? "email",
        sourceLabel,
        r.notes ?? "",
        r.created_at,
        r.updated_at,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `commitments-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDeadline(iso: string | null): string {
  if (!iso) return "no deadline";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "no deadline";
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";
  if (diffDays > 0 && diffDays < 7) return `in ${diffDays}d`;
  if (diffDays < 0 && diffDays > -14) return `${-diffDays}d overdue`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

export function CommitmentsConsole() {
  const [rows, setRows] = useState<Commitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<Direction | "all">("all");
  const [status, setStatus] = useState<Status | "all">("open");
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedMsg, setFeedMsg] = useState<string | null>(null);

  useEffect(() => {
    const urlId = new URLSearchParams(window.location.search).get("id");
    if (urlId) {
      setFocusId(urlId);
      setStatus("all");
      setDirection("all");
    }
  }, []);

  useEffect(() => {
    if (!focusId || loading) return;
    const el = document.querySelector<HTMLElement>(`[data-commitment-id="${focusId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFocusId(null), 2400);
    return () => clearTimeout(t);
  }, [focusId, loading, rows]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 'overdue' is computed by the API from status='open' + past deadline,
      // so query open commitments from the server and let the response's
      // rolled-up status field surface overdues to us.
      const queryStatus = status === "overdue" ? "open" : status;
      const params = new URLSearchParams({ limit: "300", status: queryStatus, direction });
      const res = await fetch(`/api/commitments?${params.toString()}`, { cache: "no-store" });
      const data = (await res.json()) as { commitments: Commitment[] };
      const all = data.commitments ?? [];
      setRows(status === "overdue" ? all.filter((r) => r.status === "overdue") : all);
    } finally {
      setLoading(false);
    }
  }, [status, direction]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelected(new Set());
  }, [status, direction]);

  const getFeed = useCallback(async () => {
    setFeedBusy(true);
    setFeedMsg(null);
    try {
      const r = await fetch("/api/commitments/feed-info");
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? "failed");
      setFeedUrl(j.url);
      try {
        await navigator.clipboard.writeText(j.url);
        setFeedMsg("Feed URL copied — subscribe in Google / Apple Calendar.");
      } catch {
        setFeedMsg("Feed URL shown below — copy + subscribe in your calendar.");
      }
    } catch (e) {
      setFeedMsg(e instanceof Error ? e.message : "feed unavailable");
    } finally {
      setFeedBusy(false);
    }
  }, []);

  const rotateFeed = useCallback(async () => {
    if (!confirm("Rotate the feed URL? Any existing calendar subscriptions will stop working.")) return;
    setFeedBusy(true);
    setFeedMsg(null);
    try {
      const r = await fetch("/api/commitments/feed-info", { method: "POST" });
      const j = (await r.json()) as { url?: string; error?: string };
      if (!r.ok || !j.url) throw new Error(j.error ?? "failed");
      setFeedUrl(j.url);
      try {
        await navigator.clipboard.writeText(j.url);
        setFeedMsg("New feed URL copied. Re-subscribe in your calendar.");
      } catch {
        setFeedMsg("New feed URL shown below.");
      }
    } catch (e) {
      setFeedMsg(e instanceof Error ? e.message : "rotate failed");
    } finally {
      setFeedBusy(false);
    }
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch("/api/commitments/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Commitments scan" }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "scan failed");
      }
      setScanMsg("Sweep started — scanning last 14 days of sent + received. Refresh in a moment.");
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "scan failed");
    } finally {
      setScanning(false);
    }
  }, []);

  const quickAdd = useCallback(
    async (input: {
      direction: Direction;
      other_party: string;
      other_party_email: string;
      commitment_text: string;
      deadline: string;
    }) => {
      const res = await fetch("/api/commitments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          direction: input.direction,
          other_party: input.other_party,
          other_party_email: input.other_party_email || null,
          commitment_text: input.commitment_text,
          deadline: input.deadline || null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "add failed");
      }
      const body = (await res.json()) as { commitment: Commitment };
      setRows((xs) => [body.commitment, ...xs.filter((x) => x.id !== body.commitment.id)]);
      setShowQuickAdd(false);
    },
    [],
  );

  const markStatus = useCallback(async (id: string, nextStatus: Status) => {
    await fetch(`/api/commitments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    setRows((xs) => xs.map((x) => (x.id === id ? { ...x, status: nextStatus } : x)));
  }, []);

  const del = useCallback(async (id: string) => {
    await fetch(`/api/commitments/${id}`, { method: "DELETE" });
    setRows((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const bumpDeadline = useCallback(async (id: string, days: number) => {
    const next = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
    await fetch(`/api/commitments/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deadline: next }),
    });
    setRows((xs) =>
      xs.map((x) =>
        x.id === id
          ? { ...x, deadline: next, status: x.status === "overdue" ? "open" : x.status }
          : x,
      ),
    );
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const selectAllVisible = useCallback(() => {
    setSelected(new Set(rows.map((r) => r.id)));
  }, [rows]);

  const bulk = useCallback(
    async (action: "done" | "cancelled" | "delete") => {
      const ids = Array.from(selected);
      if (ids.length === 0) return;
      if (action === "delete" && !confirm(`Delete ${ids.length} commitment${ids.length === 1 ? "" : "s"}?`)) return;
      setBulkBusy(true);
      try {
        const res = await fetch("/api/commitments/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids, action }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "bulk action failed");
        }
        if (action === "delete") {
          setRows((xs) => xs.filter((x) => !selected.has(x.id)));
        } else {
          setRows((xs) =>
            xs.map((x) => (selected.has(x.id) ? { ...x, status: action as Status } : x)),
          );
        }
        clearSelection();
      } catch (e) {
        alert(e instanceof Error ? e.message : "bulk action failed");
      } finally {
        setBulkBusy(false);
      }
    },
    [selected, clearSelection],
  );

  const outbound = rows.filter((r) => r.direction === "outbound");
  const inbound = rows.filter((r) => r.direction === "inbound");

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 960 }}>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: 18,
          marginBottom: 22,
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.6px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 4,
            }}
          >
            Commitments sweep
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              color: "var(--ink-2)",
              lineHeight: 1.55,
            }}
          >
            Pulls promises out of your last 14 days of sent + received email, plus every live meeting — both what you owe and what you're owed.
          </div>
          {scanMsg && (
            <div
              style={{
                marginTop: 8,
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: scanMsg.includes("fail") ? "#ff6b6b" : "var(--indigo)",
              }}
            >
              {scanMsg}
            </div>
          )}
        </div>
        <button
          onClick={getFeed}
          disabled={feedBusy}
          title="Get an iCal URL you can subscribe to in Google/Apple Calendar"
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "transparent",
            color: "var(--ink-2)",
            border: "1px solid var(--rule)",
            fontFamily: "var(--sans)",
            fontSize: 12,
            fontWeight: 500,
            cursor: feedBusy ? "wait" : "pointer",
            marginRight: 8,
            opacity: feedBusy ? 0.6 : 1,
          }}
        >
          {feedBusy ? "…" : "Calendar feed"}
        </button>
        <button
          onClick={() => setShowQuickAdd((v) => !v)}
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            background: "transparent",
            color: "var(--ink-2)",
            border: "1px solid var(--rule)",
            fontFamily: "var(--sans)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            marginRight: 8,
          }}
        >
          {showQuickAdd ? "Close" : "+ Add"}
        </button>
        <button
          onClick={scan}
          disabled={scanning}
          style={{
            padding: "10px 22px",
            borderRadius: 10,
            background: "var(--ink)",
            color: "#000",
            border: "none",
            fontFamily: "var(--sans)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            opacity: scanning ? 0.5 : 1,
          }}
        >
          {scanning ? "Queuing…" : "Scan last 14d"}
        </button>
      </div>

      {(feedUrl || feedMsg) && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: 12,
            padding: 14,
            marginBottom: 18,
            fontFamily: "var(--mono)",
            fontSize: 11.5,
            color: "var(--ink-2)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {feedMsg && (
            <div style={{ color: feedMsg.includes("fail") || feedMsg.includes("unavailable") ? "#ff6b6b" : "var(--indigo)" }}>
              {feedMsg}
            </div>
          )}
          {feedUrl && (
            <>
              <div
                style={{
                  wordBreak: "break-all",
                  color: "var(--ink)",
                  padding: "6px 8px",
                  background: "var(--panel)",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                }}
              >
                {feedUrl}
              </div>
              <div style={{ display: "flex", gap: 10, fontSize: 11, color: "var(--ink-3)" }}>
                <span>Google Calendar → From URL. Apple Calendar → File → New Calendar Subscription.</span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={rotateFeed}
                  disabled={feedBusy}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--rule)",
                    color: "var(--ink-3)",
                    borderRadius: 4,
                    padding: "3px 8px",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    cursor: feedBusy ? "wait" : "pointer",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  Rotate
                </button>
                <button
                  onClick={() => { setFeedUrl(null); setFeedMsg(null); }}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--rule)",
                    color: "var(--ink-3)",
                    borderRadius: 4,
                    padding: "3px 8px",
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    cursor: "pointer",
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                  }}
                >
                  Hide
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {showQuickAdd && <QuickAddForm onSubmit={quickAdd} />}

      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <Pill label="All directions" active={direction === "all"} onClick={() => setDirection("all")} />
        <Pill label="You owe" active={direction === "outbound"} onClick={() => setDirection("outbound")} />
        <Pill label="They owe" active={direction === "inbound"} onClick={() => setDirection("inbound")} />
        <div style={{ width: 16 }} />
        <Pill label="Open" active={status === "open"} onClick={() => setStatus("open")} color={STATUS_COLOR.open} />
        <Pill label="Overdue" active={status === "overdue"} onClick={() => setStatus("overdue")} color={STATUS_COLOR.overdue} />
        <Pill label="Done" active={status === "done"} onClick={() => setStatus("done")} color={STATUS_COLOR.done} />
        <Pill label="Cancelled" active={status === "cancelled"} onClick={() => setStatus("cancelled")} color={STATUS_COLOR.cancelled} />
        <Pill label="All" active={status === "all"} onClick={() => setStatus("all")} />
        <div style={{ flex: 1 }} />
        <button
          onClick={() => downloadCsv(rows)}
          disabled={rows.length === 0}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            padding: "6px 12px",
            background: "transparent",
            color: "var(--ink-3)",
            border: "1px solid var(--rule)",
            borderRadius: 6,
            cursor: rows.length === 0 ? "not-allowed" : "pointer",
            letterSpacing: "0.6px",
            opacity: rows.length === 0 ? 0.4 : 1,
          }}
        >
          EXPORT CSV
        </button>
      </div>

      {selected.size > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            marginBottom: 14,
            background: "var(--surface-2)",
            border: "1px solid var(--indigo-soft)",
            borderRadius: 10,
            fontFamily: "var(--sans)",
            fontSize: 13,
          }}
        >
          <span style={{ color: "var(--ink-2)" }}>
            {selected.size} selected
          </span>
          <button
            onClick={() => bulk("done")}
            disabled={bulkBusy}
            style={{ ...btnBulk, color: "var(--indigo)" }}
          >
            MARK DONE
          </button>
          <button
            onClick={() => bulk("cancelled")}
            disabled={bulkBusy}
            style={btnBulk}
          >
            CANCEL
          </button>
          <button
            onClick={() => bulk("delete")}
            disabled={bulkBusy}
            style={{ ...btnBulk, color: "var(--magenta, #ff6b6b)" }}
          >
            DELETE
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={selectAllVisible}
            disabled={bulkBusy || selected.size === rows.length}
            style={btnBulk}
          >
            SELECT ALL ({rows.length})
          </button>
          <button onClick={clearSelection} disabled={bulkBusy} style={btnBulk}>
            CLEAR
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--ink-3)",
            fontSize: 13,
            border: "1px dashed var(--rule)",
            borderRadius: 14,
          }}
        >
          No commitments here. Run a scan to sweep your email.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {direction !== "inbound" && outbound.length > 0 && (
            <Section
              title={`You owe · ${outbound.length}`}
              color={STATUS_COLOR.open}
              rows={outbound}
              onStatus={markStatus}
              onDelete={del}
              onBump={bumpDeadline}
              selected={selected}
              onToggle={toggleSelect}
              focusId={focusId}
            />
          )}
          {direction !== "outbound" && inbound.length > 0 && (
            <Section
              title={`They owe you · ${inbound.length}`}
              color="#ffb27a"
              rows={inbound}
              onStatus={markStatus}
              onDelete={del}
              onBump={bumpDeadline}
              selected={selected}
              onToggle={toggleSelect}
              focusId={focusId}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Pill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 11.5,
        fontFamily: "var(--sans)",
        border: `1px solid ${active ? (color ?? "var(--ink)") : "var(--rule)"}`,
        background: active ? (color ? `${color}22` : "var(--surface-2)") : "transparent",
        color: active ? "var(--ink)" : "var(--ink-3)",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function Section({
  title,
  color,
  rows,
  onStatus,
  onDelete,
  onBump,
  selected,
  onToggle,
  focusId,
}: {
  title: string;
  color: string;
  rows: Commitment[];
  onStatus: (id: string, s: Status) => void;
  onDelete: (id: string) => void;
  onBump: (id: string, days: number) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  focusId: string | null;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.6px",
          textTransform: "uppercase",
          color,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <Row
            key={r.id}
            r={r}
            onStatus={onStatus}
            onDelete={onDelete}
            onBump={onBump}
            isSelected={selected.has(r.id)}
            onToggle={onToggle}
            isFocused={focusId === r.id}
          />
        ))}
      </div>
    </div>
  );
}

function Row({
  r,
  onStatus,
  onDelete,
  onBump,
  isSelected,
  onToggle,
  isFocused,
}: {
  r: Commitment;
  onStatus: (id: string, s: Status) => void;
  onDelete: (id: string) => void;
  onBump: (id: string, days: number) => void;
  isSelected: boolean;
  onToggle: (id: string) => void;
  isFocused: boolean;
}) {
  const isDone = r.status === "done" || r.status === "cancelled";
  const deadlineStr = formatDeadline(r.deadline);
  const isOverdue = r.status === "overdue";
  return (
    <div
      data-commitment-id={r.id}
      style={{
        display: "flex",
        gap: 14,
        alignItems: "center",
        padding: "12px 16px",
        background: isFocused
          ? "var(--indigo-soft)"
          : isSelected
          ? "var(--surface-2)"
          : "var(--surface)",
        border: `1px solid ${isFocused ? "var(--indigo)" : isSelected ? "var(--indigo-soft)" : "var(--rule)"}`,
        borderRadius: 12,
        opacity: isDone ? 0.55 : 1,
        transition: "background 240ms ease, border-color 240ms ease",
      }}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggle(r.id)}
        aria-label="Select commitment"
        style={{
          width: 14,
          height: 14,
          accentColor: "var(--indigo)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: STATUS_COLOR[r.status],
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            color: "var(--ink)",
            lineHeight: 1.45,
            textDecoration: isDone ? "line-through" : "none",
          }}
        >
          {r.commitment_text}
        </div>
        <div
          style={{
            marginTop: 4,
            display: "flex",
            gap: 12,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-3)",
            letterSpacing: "0.4px",
            flexWrap: "wrap",
          }}
        >
          <span>
            {DIRECTION_LABEL[r.direction]}:{" "}
            {r.other_party_email ? (
              <a
                href={`/contacts?email=${encodeURIComponent(r.other_party_email)}`}
                title="Open contact profile"
                style={{ color: "inherit", textDecoration: "underline dotted" }}
              >
                {r.other_party}
              </a>
            ) : (
              r.other_party
            )}
          </span>
          <span style={{ color: isOverdue ? STATUS_COLOR.overdue : "var(--ink-3)" }}>
            {deadlineStr}
          </span>
          {r.source_kind === "meeting" && r.source_meeting_title ? (
            <span
              title={`From meeting: ${r.source_meeting_title}`}
              style={{ color: "var(--indigo)" }}
            >
              MEETING · {r.source_meeting_title.slice(0, 36)}
              {r.source_meeting_title.length > 36 ? "…" : ""}
            </span>
          ) : r.source_email_subject ? (
            <span title={r.source_email_subject}>
              &quot;{r.source_email_subject.slice(0, 40)}
              {r.source_email_subject.length > 40 ? "…" : ""}&quot;
            </span>
          ) : null}
        </div>
      </div>
      {isOverdue && (
        <a
          href={`/chat?q=${encodeURIComponent(
            r.direction === "outbound"
              ? `Draft a follow-up to ${r.other_party} about: ${r.commitment_text}`
              : `Draft a polite reminder to ${r.other_party} about: ${r.commitment_text}`,
          )}`}
          title="Draft a nudge in chat"
          style={{ ...btn, textDecoration: "none", color: "var(--indigo)", borderColor: "var(--indigo)" }}
        >
          NUDGE
        </a>
      )}
      {isOverdue && (
        <button
          onClick={() => onBump(r.id, 7)}
          title="Bump deadline by 7 days"
          style={btn}
        >
          +7D
        </button>
      )}
      {!isDone && (
        <button
          onClick={() => onStatus(r.id, "done")}
          title="Mark done"
          style={btn}
        >
          DONE
        </button>
      )}
      {!isDone && (
        <button
          onClick={() => onStatus(r.id, "cancelled")}
          title="Cancel"
          style={btn}
        >
          SKIP
        </button>
      )}
      <button onClick={() => onDelete(r.id)} title="Delete" style={btn}>
        ×
      </button>
    </div>
  );
}

const btn: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  color: "var(--ink-3)",
  background: "transparent",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  padding: "4px 8px",
  cursor: "pointer",
  letterSpacing: "0.4px",
};

const btnBulk: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 10.5,
  color: "var(--ink-2)",
  background: "transparent",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  padding: "5px 10px",
  cursor: "pointer",
  letterSpacing: "0.6px",
};

function QuickAddForm({
  onSubmit,
}: {
  onSubmit: (input: {
    direction: Direction;
    other_party: string;
    other_party_email: string;
    commitment_text: string;
    deadline: string;
  }) => Promise<void>;
}) {
  const [direction, setDirection] = useState<Direction>("outbound");
  const [otherParty, setOtherParty] = useState("");
  const [otherPartyEmail, setOtherPartyEmail] = useState("");
  const [commitmentText, setCommitmentText] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputStyle: React.CSSProperties = {
    background: "transparent",
    border: "1px solid var(--rule)",
    borderRadius: 6,
    color: "var(--ink)",
    fontFamily: "var(--sans)",
    fontSize: 13,
    padding: "8px 10px",
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!otherParty.trim() || !commitmentText.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        direction,
        other_party: otherParty.trim(),
        other_party_email: otherPartyEmail.trim(),
        commitment_text: commitmentText.trim(),
        deadline,
      });
      setOtherParty("");
      setOtherPartyEmail("");
      setCommitmentText("");
      setDeadline("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "add failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 14,
        padding: 18,
        marginBottom: 22,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setDirection("outbound")}
          style={{
            ...inputStyle,
            cursor: "pointer",
            background: direction === "outbound" ? "var(--surface-2)" : "transparent",
            color: direction === "outbound" ? "var(--ink)" : "var(--ink-3)",
          }}
        >
          You owe
        </button>
        <button
          type="button"
          onClick={() => setDirection("inbound")}
          style={{
            ...inputStyle,
            cursor: "pointer",
            background: direction === "inbound" ? "var(--surface-2)" : "transparent",
            color: direction === "inbound" ? "var(--ink)" : "var(--ink-3)",
          }}
        >
          They owe
        </button>
      </div>
      <input
        placeholder={direction === "outbound" ? "Who you owe (e.g. Ana Ruiz)" : "Who owes you"}
        value={otherParty}
        onChange={(e) => setOtherParty(e.target.value)}
        style={inputStyle}
      />
      <input
        type="email"
        placeholder="Their email (optional — used to match emails + meetings)"
        value={otherPartyEmail}
        onChange={(e) => setOtherPartyEmail(e.target.value)}
        style={inputStyle}
      />
      <input
        placeholder="What was promised (e.g. send pricing deck)"
        value={commitmentText}
        onChange={(e) => setCommitmentText(e.target.value)}
        style={inputStyle}
      />
      <input
        type="date"
        value={deadline}
        onChange={(e) => setDeadline(e.target.value)}
        style={inputStyle}
      />
      {error && (
        <div style={{ color: "#ff6b6b", fontFamily: "var(--mono)", fontSize: 11 }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={busy || !otherParty.trim() || !commitmentText.trim()}
        style={{
          ...inputStyle,
          background: "var(--ink)",
          color: "#000",
          border: "none",
          padding: "10px 20px",
          fontWeight: 500,
          cursor: busy ? "wait" : "pointer",
          opacity: busy || !otherParty.trim() || !commitmentText.trim() ? 0.5 : 1,
          alignSelf: "flex-start",
        }}
      >
        {busy ? "Adding…" : "Add commitment"}
      </button>
    </form>
  );
}
