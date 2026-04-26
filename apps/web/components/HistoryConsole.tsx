"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_user_message: string | null;
  message_count: number;
  total_cost_usd: number | null;
  task_count: number;
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `${(usd * 100).toFixed(2)}¢`;
  if (usd < 1) return `${(usd * 100).toFixed(1)}¢`;
  return `$${usd.toFixed(2)}`;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  created_at: string;
}

interface ConversationDetail {
  conversation: { id: string; title: string | null };
  messages: Message[];
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function prettifyContent(role: string, raw: string): string {
  const trimmed = raw.trim();
  if (role === "tool" || role === "system") {
    try {
      const parsed = JSON.parse(trimmed);
      return "```json\n" + JSON.stringify(parsed, null, 2) + "\n```";
    } catch {
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return "```\n" + trimmed + "\n```";
      }
    }
  }
  return trimmed;
}

function conversationToMarkdown(detail: ConversationDetail): string {
  const header = `# ${detail.conversation.title ?? "Untitled conversation"}\n\n`;
  const body = detail.messages
    .map((m) => {
      const who = m.role === "user" ? "You" : m.role === "assistant" ? "JARVIS" : m.role;
      const when = formatTimestamp(m.created_at);
      return `## ${who} · ${when}\n\n${prettifyContent(m.role, m.content)}\n`;
    })
    .join("\n");
  return header + body;
}

function conversationToJson(detail: ConversationDetail): string {
  return JSON.stringify(
    {
      conversation: detail.conversation,
      exported_at: new Date().toISOString(),
      messages: detail.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        created_at: m.created_at,
      })),
    },
    null,
    2,
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "conversation";
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadMarkdown(detail: ConversationDetail) {
  const title = detail.conversation.title ?? "conversation";
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(
    conversationToMarkdown(detail),
    `${date}-${slugify(title)}.md`,
    "text/markdown",
  );
}

function downloadJson(detail: ConversationDetail) {
  const title = detail.conversation.title ?? "conversation";
  const date = new Date().toISOString().slice(0, 10);
  downloadFile(
    conversationToJson(detail),
    `${date}-${slugify(title)}.json`,
    "application/json",
  );
}

export function HistoryConsole() {
  const [list, setList] = useState<ConversationSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 720px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    if (c) {
      setSelectedId(c);
      return;
    }
    const t = params.get("task");
    if (t) {
      fetch(`/api/tasks/${t}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ task?: { conversation_id?: string | null } }>) : null))
        .then((body) => {
          const convId = body?.task?.conversation_id;
          if (convId) setSelectedId(convId);
        })
        .catch(() => {});
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/conversations?limit=100", { cache: "no-store" });
      const data = (await res.json()) as { conversations: ConversationSummary[] };
      setList(data.conversations ?? []);
      const first = data.conversations?.[0];
      if (!selectedId && first && !isMobile) {
        setSelectedId(first.id);
      }
    } finally {
      setLoadingList(false);
    }
  }, [selectedId, isMobile]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    fetch(`/api/conversations/${selectedId}/messages`, { cache: "no-store" })
      .then((r) => r.json() as Promise<ConversationDetail>)
      .then(setDetail)
      .finally(() => setLoadingDetail(false));
  }, [selectedId]);

  const deleteConv = useCallback(
    async (id: string) => {
      if (!confirm("Delete this conversation and all its messages?")) return;
      await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
      setList((xs) => xs.filter((x) => x.id !== id));
      if (selectedId === id) setSelectedId(null);
    },
    [selectedId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      if (c.title?.toLowerCase().includes(q)) return true;
      if (c.last_user_message?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [list, search]);

  const showList = !isMobile || !selectedId;
  const showMain = !isMobile || !!selectedId;

  return (
    <div style={{ display: "flex", height: "calc(100vh - 88px)" }}>
      {showList && (
      <aside
        style={{
          width: isMobile ? "100%" : 340,
          borderRight: isMobile ? "none" : "1px solid var(--rule)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--rule)" }}>
          <input
            placeholder="Search conversations…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              width: "100%",
              padding: "9px 12px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--rule)",
              color: "var(--ink)",
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              outline: "none",
            }}
          />
          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
            }}
          >
            {loadingList ? "LOADING…" : `${filtered.length} OF ${list.length}`}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              style={{
                width: "100%",
                textAlign: "left",
                display: "block",
                padding: "12px 18px",
                background: selectedId === c.id ? "var(--surface-2)" : "transparent",
                border: "none",
                borderBottom: "1px solid var(--rule)",
                cursor: "pointer",
                color: "var(--ink)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 13,
                  fontWeight: 500,
                  marginBottom: 2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {c.title ?? "Untitled"}
              </div>
              <div
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1.4,
                }}
              >
                {c.last_user_message?.slice(0, 80) ?? "—"}
              </div>
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  gap: 10,
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-3)",
                  letterSpacing: "0.4px",
                }}
              >
                <span>{formatRelative(c.updated_at)}</span>
                <span>{c.message_count} msgs</span>
                {c.task_count > 0 && <span>{c.task_count} tasks</span>}
                {c.total_cost_usd !== null && c.total_cost_usd > 0 && (
                  <span style={{ color: "var(--indigo)" }}>{formatCost(c.total_cost_usd)}</span>
                )}
              </div>
            </button>
          ))}
          {!loadingList && filtered.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--ink-3)", fontSize: 12 }}>
              No conversations match.
            </div>
          )}
        </div>
      </aside>
      )}

      {showMain && (
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {!selectedId ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-3)",
              fontFamily: "var(--sans)",
              fontSize: 13,
            }}
          >
            Select a conversation.
          </div>
        ) : loadingDetail || !detail ? (
          <div style={{ padding: 32, color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <div
              style={{
                padding: "14px 24px",
                borderBottom: "1px solid var(--rule)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              {isMobile && (
                <button
                  onClick={() => setSelectedId(null)}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 16,
                    color: "var(--ink-2)",
                    background: "transparent",
                    border: "1px solid var(--rule)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    cursor: "pointer",
                  }}
                >
                  ←
                </button>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--serif)",
                    fontSize: 18,
                    color: "var(--ink)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {detail.conversation.title ?? "Untitled"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                    letterSpacing: "0.4px",
                    marginTop: 2,
                  }}
                >
                  {detail.messages.length} MESSAGES
                </div>
              </div>
              <button
                onClick={() => downloadMarkdown(detail)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                  background: "transparent",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.4px",
                  marginRight: 8,
                }}
              >
                EXPORT MD
              </button>
              <button
                onClick={() => downloadJson(detail)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                  background: "transparent",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.4px",
                  marginRight: 8,
                }}
              >
                EXPORT JSON
              </button>
              <button
                onClick={() => deleteConv(selectedId)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                  background: "transparent",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  padding: "6px 10px",
                  cursor: "pointer",
                  letterSpacing: "0.4px",
                }}
              >
                DELETE
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "24px 24px 48px" }}>
              {detail.messages.length === 0 ? (
                <div style={{ color: "var(--ink-3)", fontSize: 13 }}>No messages in this conversation.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {detail.messages.map((m) => (
                    <MessageRow key={m.id} m={m} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
      )}
    </div>
  );
}

function MessageRow({ m }: { m: Message }) {
  const isUser = m.role === "user";
  return (
    <div
      style={{
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          width: 60,
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: isUser ? "var(--indigo)" : "var(--ink-3)",
          letterSpacing: "0.4px",
          paddingTop: 2,
          textTransform: "uppercase",
        }}
      >
        {isUser ? "YOU" : m.role === "assistant" ? "JARVIS" : m.role}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            color: "var(--ink)",
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {m.content}
        </div>
        <div
          style={{
            marginTop: 4,
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--ink-3)",
            letterSpacing: "0.4px",
          }}
        >
          {formatTimestamp(m.created_at)}
        </div>
      </div>
    </div>
  );
}
