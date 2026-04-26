"use client";

// InboxConsole: real inbox triage surface. Shows the latest inbox task for the
// current user — whether it's still running, needs approval, or is done. If
// Gmail isn't connected we nudge the user to /integrations instead of pretending
// to have data. Approval + reject go straight to /api/tasks/[id]/approve|reject.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/jarvis/Chip";

type InboxEntry = {
  email: {
    id: string;
    thread_id: string;
    from: string;
    to?: string;
    subject: string;
    snippet?: string;
    body?: string;
    received_at?: string;
    message_id_header?: string;
  };
  classification: "needs_reply" | "fyi" | "newsletter" | "spam" | "action_required";
  priority: "high" | "medium" | "low";
  reason: string;
  suggested_reply?: { subject: string; body: string };
};

type InboxResult = {
  query: string;
  count: number;
  entries: InboxEntry[];
};

type LatestResponse = {
  ok: true;
  gmail_connected: boolean;
  task: {
    id: string;
    status: string;
    error: string | null;
    created_at: string;
    completed_at: string | null;
    needs_approval_at: string | null;
    title: string;
  } | null;
  result: InboxResult | null;
};

const CLASSIFICATION_LABEL: Record<InboxEntry["classification"], string> = {
  needs_reply: "NEEDS REPLY",
  action_required: "ACTION",
  fyi: "FYI",
  newsletter: "NEWSLETTER",
  spam: "SPAM",
};

export function InboxConsole() {
  const [data, setData] = useState<LatestResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox/latest", { cache: "no-store" });
      const body = (await res.json()) as LatestResponse;
      if (!res.ok) throw new Error("load failed");
      setData(body);
      const first = body.result?.entries[0];
      if (first && !selectedId) {
        setSelectedId(first.email.id);
      }
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  async function triageNow() {
    if (busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch("/api/inbox/run", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "run failed");
      setFlash("Triaging now — this takes ~10-30s.");
      setTimeout(() => void load(), 2000);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function approveAll() {
    if (!data?.task?.id || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      const res = await fetch(`/api/tasks/${data.task.id}/approve`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "approve failed");
      setFlash("Drafts created in Gmail.");
      await load();
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const connected = data?.gmail_connected ?? false;
  const status = data?.task?.status;
  const result = data?.result;
  const entries = result?.entries ?? [];
  const selected = entries.find((e) => e.email.id === selectedId) ?? entries[0];
  const needsApproval = status === "needs_approval";
  const running = status === "queued" || status === "running";

  if (!data) {
    return <Centered>Loading inbox…</Centered>;
  }

  if (!connected) {
    return (
      <Centered>
        <div style={{ maxWidth: 460, textAlign: "center", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: 26, fontStyle: "italic", color: "var(--ink)" }}>
            Gmail isn&rsquo;t connected.
          </div>
          <div style={{ fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.6 }}>
            I can&rsquo;t triage what I can&rsquo;t see. Connect your Gmail and I&rsquo;ll start classifying unread threads and drafting replies for the ones that need them — all held for your approval before anything sends.
          </div>
          <div>
            <Link href="/integrations" style={primaryLink}>
              Connect Gmail
            </Link>
          </div>
        </div>
      </Centered>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 150px)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 32px",
          borderBottom: "1px solid var(--rule)",
          gap: 16,
        }}
      >
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-3)", letterSpacing: "0.8px" }}>
          {data.task
            ? `LAST RUN · ${timeAgo(data.task.created_at)} · ${status?.toUpperCase()}`
            : "NO RUNS YET"}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {flash && (
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{flash}</span>
          )}
          {needsApproval && entries.some((e) => e.suggested_reply) && (
            <button onClick={approveAll} disabled={busy} style={primaryBtn}>
              Approve all drafts
            </button>
          )}
          <button onClick={triageNow} disabled={busy || running} style={secondaryBtn}>
            {running ? "Running…" : "Triage now"}
          </button>
        </div>
      </div>

      {!result && running && (
        <Centered>Classifying emails — this usually takes 10-30 seconds.</Centered>
      )}

      {!result && !running && (
        <Centered>
          <div style={{ maxWidth: 420, textAlign: "center" }}>
            <div style={{ fontFamily: "var(--serif)", fontSize: 22, fontStyle: "italic", color: "var(--ink)" }}>
              No triage yet.
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 8, lineHeight: 1.55 }}>
              Hit &ldquo;Triage now&rdquo; to pull your unread from the last 24h and draft replies for the ones that need them.
            </div>
          </div>
        </Centered>
      )}

      {result && entries.length === 0 && (
        <Centered>
          <div style={{ fontFamily: "var(--serif)", fontSize: 22, fontStyle: "italic" }}>Inbox zero.</div>
        </Centered>
      )}

      {result && entries.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "360px 1fr",
            flex: 1,
            minHeight: 0,
          }}
        >
          <div style={{ overflowY: "auto", borderRight: "1px solid var(--rule)" }}>
            {entries.map((e) => (
              <InboxListItem
                key={e.email.id}
                entry={e}
                active={selected?.email.id === e.email.id}
                onClick={() => setSelectedId(e.email.id)}
              />
            ))}
          </div>
          <div style={{ overflowY: "auto", padding: "28px 40px 40px" }}>
            {selected && <InboxDetail entry={selected} />}
          </div>
        </div>
      )}
    </div>
  );
}

function InboxListItem({
  entry,
  active,
  onClick,
}: {
  entry: InboxEntry;
  active: boolean;
  onClick: () => void;
}) {
  const chipColor =
    entry.classification === "needs_reply"
      ? "var(--magenta)"
      : entry.classification === "action_required"
        ? "var(--indigo)"
        : "var(--ink-3)";
  const chipBorder =
    entry.classification === "needs_reply"
      ? "var(--magenta-soft)"
      : entry.classification === "action_required"
        ? "var(--indigo-soft)"
        : "var(--rule)";

  return (
    <div
      onClick={onClick}
      style={{
        padding: "14px 20px",
        borderBottom: "1px solid var(--rule-soft)",
        background: active ? "var(--surface)" : "transparent",
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13,
            color: "var(--ink)",
            fontWeight: 600,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.email.from}
        </span>
        {entry.email.received_at && (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)" }}>
            {timeAgo(entry.email.received_at)}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          color: "var(--ink-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: 4,
        }}
      >
        {entry.email.subject}
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 12,
          color: "var(--ink-4)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          marginBottom: 6,
        }}
      >
        {entry.email.snippet ?? entry.reason}
      </div>
      <Chip color={chipColor} border={chipBorder} size={9.5}>
        {CLASSIFICATION_LABEL[entry.classification]}
      </Chip>
    </div>
  );
}

function InboxDetail({ entry }: { entry: InboxEntry }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 14,
          borderBottom: "1px solid var(--rule-soft)",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 26,
              color: "var(--ink)",
              letterSpacing: "-0.3px",
            }}
          >
            {entry.email.subject}
          </div>
          <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
            {entry.email.from}
            {entry.email.received_at ? ` · ${timeAgo(entry.email.received_at)}` : ""}
          </div>
        </div>
        <Chip
          color={
            entry.classification === "needs_reply"
              ? "var(--magenta)"
              : entry.classification === "action_required"
                ? "var(--indigo)"
                : "var(--ink-3)"
          }
          border={
            entry.classification === "needs_reply"
              ? "var(--magenta-soft)"
              : entry.classification === "action_required"
                ? "var(--indigo-soft)"
                : "var(--rule)"
          }
        >
          {CLASSIFICATION_LABEL[entry.classification]}
        </Chip>
      </div>

      {entry.reason && (
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            color: "var(--ink-3)",
            padding: "14px 0 0",
            fontStyle: "italic",
          }}
        >
          {entry.reason}
        </div>
      )}

      {entry.email.body && (
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--ink-2)",
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            padding: "16px 0",
          }}
        >
          {entry.email.body}
        </div>
      )}

      {entry.suggested_reply && (
        <div
          style={{
            marginTop: 18,
            padding: "18px 20px",
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              color: "var(--indigo)",
              marginBottom: 10,
            }}
          >
            Drafted reply
          </div>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              color: "var(--ink-2)",
              marginBottom: 8,
            }}
          >
            <strong>Subject:</strong> {entry.suggested_reply.subject}
          </div>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 16,
              color: "var(--ink)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {entry.suggested_reply.body}
          </div>
        </div>
      )}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
        color: "var(--ink-3)",
        fontFamily: "var(--sans)",
        fontSize: 13.5,
      }}
    >
      {children}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "soon";
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

const primaryBtn: React.CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 12.5,
  fontWeight: 500,
  color: "white",
  background: "var(--indigo)",
  border: "none",
  borderRadius: 8,
  padding: "7px 14px",
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 12.5,
  fontWeight: 500,
  color: "var(--ink)",
  background: "transparent",
  border: "1px solid var(--rule)",
  borderRadius: 8,
  padding: "7px 14px",
  cursor: "pointer",
};

const primaryLink: React.CSSProperties = {
  display: "inline-block",
  fontFamily: "var(--sans)",
  fontSize: 13,
  fontWeight: 500,
  color: "white",
  background: "var(--indigo)",
  borderRadius: 10,
  padding: "10px 18px",
  textDecoration: "none",
};
