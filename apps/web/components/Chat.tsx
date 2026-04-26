"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { VoiceBar, type VoiceBarHandle } from "./VoiceBar";
import { FaceGate, type FaceGateHandle } from "./FaceGate";
import { TasksPanel } from "./TasksPanel";
import { SettingsButton } from "./Settings";
import { Markdown } from "./Markdown";
import { supabaseBrowser } from "@/lib/supabase/client";
import { deviceKind, runDeviceAction, getScreenContext } from "@/lib/tauri";

const ACTION_TOOLS = new Set([
  "open_url",
  "launch_app",
  "run_shortcut",
  "play_spotify",
  "control_spotify",
  "applescript",
  "type_text",
  "press_keys",
  "imessage_send",
  "notes_create",
  "music_play",
  "music_control",
]);

const READ_TOOLS = new Set([
  "read_app_text",
  "imessage_read",
  "contacts_lookup",
  "notes_read",
  "obsidian_search",
]);

const MAX_FOLLOWUP_ROUNDS = 10;

function readLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "read_screen":
      return "👁️ looking at screen…";
    case "read_app_text":
      return `📖 reading ${args.app ?? "app"}…`;
    case "imessage_read":
      return args.contact ? `💬 reading messages with ${args.contact}…` : "💬 reading recent messages…";
    case "contacts_lookup":
      return `👤 looking up ${args.query ?? "contact"}…`;
    case "notes_read":
      return args.query ? `📝 searching notes for ${args.query}…` : "📝 reading notes…";
    case "obsidian_search":
      return `📚 searching Obsidian for ${args.query ?? ""}…`;
    default:
      return `🔍 ${name}…`;
  }
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  tool?: { name: string; result?: unknown; error?: string };
  status?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string | null;
  updated_at: string;
}

interface FollowupRequest {
  toolName: string;
  args: Record<string, unknown>;
}

interface RoundResult {
  finalReply: string;
  followup: FollowupRequest | null;
  conversationId: string | null;
}

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [voiceReply, setVoiceReply] = useState(true);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<VoiceBarHandle>(null);
  const faceRef = useRef<FaceGateHandle>(null);
  const turnsRef = useRef<Turn[]>([]);
  const conversationIdRef = useRef<string | null>(null);
  turnsRef.current = turns;
  conversationIdRef.current = conversationId;

  const refreshConversations = useCallback(async () => {
    try {
      const r = await fetch("/api/conversations");
      if (!r.ok) return;
      const d = (await r.json()) as { conversations: ConversationSummary[] };
      setConversations(d.conversations);
    } catch {
      // ignore
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/conversations/${id}/messages`);
      if (!r.ok) return;
      const d = (await r.json()) as {
        conversation: { id: string; title: string | null };
        messages: { role: "user" | "assistant"; content: string }[];
      };
      setConversationId(d.conversation.id);
      setTurns(
        d.messages.map((m) => ({ role: m.role, text: m.content })),
      );
      const url = new URL(window.location.href);
      url.searchParams.set("c", id);
      window.history.replaceState({}, "", url.toString());
    } catch {
      // ignore
    }
  }, []);

  const newChat = useCallback(() => {
    setConversationId(null);
    setTurns([]);
    const url = new URL(window.location.href);
    url.searchParams.delete("c");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/conversations?id=${id}`, { method: "DELETE" });
      if (conversationIdRef.current === id) newChat();
      refreshConversations();
    },
    [newChat, refreshConversations],
  );

  useEffect(() => {
    refreshConversations();
    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    if (c) loadConversation(c);
    const q = params.get("q");
    if (q) {
      setInput(q);
      const url = new URL(window.location.href);
      url.searchParams.delete("q");
      window.history.replaceState({}, "", url.toString());
    }
  }, [refreshConversations, loadConversation]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const runRound = useCallback(
    async (
      message: string,
      screenshotB64: string | null,
      cid: string | null,
      isFollowup: boolean,
    ): Promise<RoundResult> => {
      let finalReply = "";
      let followup: FollowupRequest | null = null;
      let newCid: string | null = cid;

      const screen = isFollowup ? null : await getScreenContext();
      const screenContext = screen
        ? { app: screen.app, text: screen.text, capturedAt: screen.captured_at }
        : null;

      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          screenshotB64,
          screenContext,
          conversationId: cid,
          isFollowup,
          deviceKind: deviceKind(),
        }),
      });
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const event = JSON.parse(part.slice(6)) as Record<string, unknown>;
          if (event.type === "conversation") {
            newCid = event.id as string;
            if (!conversationIdRef.current) {
              setConversationId(newCid);
              const url = new URL(window.location.href);
              url.searchParams.set("c", newCid);
              window.history.replaceState({}, "", url.toString());
            }
          } else if (event.type === "text_delta") {
            const delta = event.text as string;
            finalReply += delta;
            setTurns((t) => {
              const last = t[t.length - 1]!;
              return [...t.slice(0, -1), { ...last, text: last.text + delta }];
            });
          } else if (event.type === "tool_use") {
            const name = event.name as string;
            const args = (event.input ?? {}) as Record<string, unknown>;
            if (READ_TOOLS.has(name)) {
              followup = { toolName: name, args };
              const label = readLabel(name, args);
              setTurns((t) => [...t, { role: "assistant", text: label, status: true }]);
            } else if (ACTION_TOOLS.has(name)) {
              setTurns((t) => [
                ...t,
                { role: "assistant", text: `🔧 ${name}`, tool: { name } },
                { role: "assistant", text: "" },
              ]);
              runDeviceAction(name, args)
                .then((result) => {
                  if (!result.ok) {
                    setTurns((t) => [
                      ...t,
                      {
                        role: "assistant",
                        text: `⚠️ ${name} failed: ${result.output || "unknown error"}`,
                      },
                    ]);
                  }
                })
                .catch((e) => {
                  setTurns((t) => [
                    ...t,
                    {
                      role: "assistant",
                      text: `⚠️ ${name} failed: ${e instanceof Error ? e.message : String(e)}`,
                    },
                  ]);
                });
            }
          }
        }
      }

      return { finalReply, followup, conversationId: newCid };
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const userText = text.trim();
      if (!userText || pending) return;

      const gate = faceRef.current;
      if (gate?.isGateActive()) {
        const p = gate.getPresence();
        if (p === "unknown") {
          setTurns((t) => [
            ...t,
            { role: "user", text: userText },
            { role: "assistant", text: "🔒 I don't recognise you.", status: true },
          ]);
          setInput("");
          return;
        }
        if (p === "no-face" || p === "loading") {
          setTurns((t) => [
            ...t,
            { role: "user", text: userText },
            { role: "assistant", text: "🔒 I can't see you — step in front of the camera.", status: true },
          ]);
          setInput("");
          return;
        }
      }

      setInput("");
      setTurns((t) => [...t, { role: "user", text: userText }, { role: "assistant", text: "" }]);
      setPending(true);

      let nextMessage = userText;
      let nextScreenshot: string | null = null;
      let nextIsFollowup = false;
      let cid = conversationIdRef.current;
      let lastReply = "";

      try {
        for (let round = 0; round < MAX_FOLLOWUP_ROUNDS; round++) {
          const { finalReply, followup, conversationId: returnedCid } = await runRound(
            nextMessage,
            nextScreenshot,
            cid,
            nextIsFollowup,
          );
          if (returnedCid) cid = returnedCid;
          lastReply = finalReply;
          if (!followup) break;

          const r = await runDeviceAction(followup.toolName, followup.args);
          const argLabel = Object.entries(followup.args)
            .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
            .join(", ");
          nextMessage = r.ok
            ? `[${followup.toolName}(${argLabel}) result]\n${r.output}`
            : `[${followup.toolName}(${argLabel}) failed: ${r.output}]`;
          nextScreenshot = null;
          nextIsFollowup = true;

          setTurns((t) => [...t, { role: "assistant", text: "" }]);
        }
      } catch (err) {
        setTurns((t) => [
          ...t,
          { role: "assistant", text: `⚠️ ${err instanceof Error ? err.message : String(err)}` },
        ]);
      } finally {
        setPending(false);
        refreshConversations();
      }

      if (voiceReply && lastReply.trim()) {
        voiceRef.current?.speak(lastReply).catch(() => {});
      }
    },
    [pending, voiceReply, runRound, refreshConversations],
  );

  return (
    <div className="flex h-screen">
      {sidebarOpen && (
        <aside className="w-64 border-r border-white/10 flex flex-col">
          <div className="p-3 flex items-center justify-between border-b border-white/10">
            <button
              onClick={newChat}
              className="text-xs bg-accent text-ink font-medium px-3 py-1.5 rounded-md"
            >
              + New chat
            </button>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-white/40 text-xs px-2"
              aria-label="Close sidebar"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            {conversations.length === 0 && (
              <div className="text-white/30 text-xs px-2 py-4 text-center">No chats yet</div>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md text-xs ${
                  conversationId === c.id ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <button
                  onClick={() => loadConversation(c.id)}
                  className="flex-1 text-left px-2 py-2 truncate"
                  title={c.title ?? "(untitled)"}
                >
                  {c.title ?? "(untitled)"}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(c.id);
                  }}
                  className="px-2 py-2 text-white/30 hover:text-white/70 opacity-0 group-hover:opacity-100"
                  aria-label="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}
      <div className="flex flex-col flex-1 max-w-3xl mx-auto">
        <header className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                className="text-white/60 text-sm"
                aria-label="Open sidebar"
              >
                ☰
              </button>
            )}
            <h1 className="text-lg font-semibold">JARVIS</h1>
          </div>
          <div className="flex items-center gap-4">
            <FaceGate ref={faceRef} />
            <TasksPanel />
            <SettingsButton />
            <a
              href="/features"
              className="text-xs text-white/60 hover:text-white/90"
            >
              Features
            </a>
            <a
              href="/recall"
              className="text-xs text-white/60 hover:text-white/90"
            >
              Recall
            </a>
            <a
              href="/meetings"
              className="text-xs text-white/60 hover:text-white/90"
            >
              Meetings
            </a>
            <a
              href="/autopilot"
              className="text-xs text-orange-400 hover:text-orange-300 font-semibold"
            >
              Autopilot
            </a>
            <button
              onClick={newChat}
              className="text-xs text-white/60 hover:text-white/90"
            >
              New chat
            </button>
            <button
              onClick={async () => {
                await supabaseBrowser().auth.signOut();
                window.location.href = "/login";
              }}
              className="text-xs text-white/60 hover:text-white/90"
            >
              Sign out
            </button>
            <label className="flex items-center gap-2 text-xs text-white/60 select-none">
              <input
                type="checkbox"
                checked={voiceReply}
                onChange={(e) => setVoiceReply(e.target.checked)}
                className="accent-accent"
              />
              Speak replies
            </label>
          </div>
        </header>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {turns.length === 0 && (
            <div className="text-white/40 text-sm pt-12 text-center">
              Say <em>"Hey Vance"</em> then ask, or type below.
            </div>
          )}
          {turns.map((t, i) => {
            const placeholder = pending && i === turns.length - 1 ? "…" : "";
            if (t.status || t.role === "user") {
              return (
                <div
                  key={i}
                  className={
                    t.status
                      ? "text-white/40 text-xs italic"
                      : "bg-accent/10 border border-accent/20 px-3 py-2 rounded-lg self-end max-w-[85%] ml-auto whitespace-pre-wrap"
                  }
                >
                  {t.text || placeholder}
                </div>
              );
            }
            return (
              <div key={i} className="text-white/90">
                {t.text ? <Markdown>{t.text}</Markdown> : placeholder}
              </div>
            );
          })}
        </div>
        <div className="px-6 py-3 border-t border-white/10 flex flex-col gap-3">
          <VoiceBar ref={voiceRef} onTranscript={(text) => send(text)} disabled={pending} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Message JARVIS…"
              disabled={pending}
              className="flex-1 bg-panel border border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:border-accent/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="bg-accent text-ink font-medium px-4 rounded-lg disabled:opacity-40"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
