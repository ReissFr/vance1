"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Orb } from "./jarvis/Orb";
import { StatusStrip } from "./jarvis/StatusStrip";
import { CommandLine } from "./jarvis/CommandLine";
import { Wordmark } from "./jarvis/Wordmark";
import { Chip } from "./jarvis/Chip";
import { Markdown } from "./Markdown";
import { LiveFeed } from "./jarvis/LiveFeed";
import { deviceKind, runDeviceAction, getScreenContext } from "@/lib/tauri";
import { supabaseBrowser } from "@/lib/supabase/client";

type OrbMode = "idle" | "listening" | "thinking" | "speaking";

type Turn = { role: "user" | "assistant"; text: string };

const READ_TOOLS = new Set([
  "read_app_text",
  "imessage_read",
  "contacts_lookup",
  "notes_read",
  "obsidian_search",
  "read_screen",
]);

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

function useTimeGreeting(name?: string) {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => {
    setHour(new Date().getHours());
  }, []);
  if (hour === null) return name ? `Hello, ${name}.` : "Hello.";
  const part =
    hour < 5 ? "Still awake" :
    hour < 12 ? "Good morning" :
    hour < 17 ? "Good afternoon" :
    hour < 22 ? "Good evening" :
    "Still going";
  return name ? `${part}, ${name}.` : `${part}.`;
}

function useClockLabel() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const update = () =>
      setLabel(
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      );
    update();
    const t = setInterval(update, 30_000);
    return () => clearInterval(t);
  }, []);
  return label;
}

export function Home({ user }: { user: { name?: string | null; email?: string | null } }) {
  const greeting = useTimeGreeting(user.name ?? undefined);
  const clock = useClockLabel();
  const [orb, setOrb] = useState<OrbMode>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [seed, setSeed] = useState<{ text: string; key: number }>({ text: "", key: 0 });

  const nudgeIdle = useCallback((delayMs = 1200) => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setOrb("idle"), delayMs);
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isBusy) return;
      setBusy(true);
      setChatOpen(true);
      setOrb("thinking");
      setTurns((t) => [...t, { role: "user", text: trimmed }, { role: "assistant", text: "" }]);

      try {
        const screen = await getScreenContext();
        const screenContext = screen
          ? { app: screen.app, text: screen.text, capturedAt: screen.captured_at }
          : null;

        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            screenshotB64: null,
            screenContext,
            conversationId: conversationIdRef.current,
            isFollowup: false,
            deviceKind: deviceKind(),
          }),
        });

        if (!res.body) throw new Error("No response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let firstDelta = true;

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
              conversationIdRef.current = event.id as string;
            } else if (event.type === "text_delta") {
              if (firstDelta) {
                setOrb("speaking");
                firstDelta = false;
              }
              const delta = event.text as string;
              setTurns((t) => {
                const last = t[t.length - 1]!;
                return [...t.slice(0, -1), { ...last, text: last.text + delta }];
              });
            } else if (event.type === "tool_use") {
              const name = event.name as string;
              const args = (event.input ?? {}) as Record<string, unknown>;
              if (ACTION_TOOLS.has(name)) {
                runDeviceAction(name, args).catch(() => {});
              } else if (READ_TOOLS.has(name)) {
                runDeviceAction(name, args).catch(() => {});
              }
            } else if (event.type === "error") {
              const msg = (event.error as string) ?? "Something went wrong.";
              setTurns((t) => {
                const last = t[t.length - 1]!;
                const existing = last.text;
                const prefix = existing ? existing + "\n\n" : "";
                return [...t.slice(0, -1), { ...last, text: `${prefix}⚠︎ ${msg}` }];
              });
            }
          }
        }
      } catch (err) {
        setTurns((t) => {
          const last = t[t.length - 1];
          const note = `⚠︎ ${err instanceof Error ? err.message : String(err)}`;
          if (last && last.role === "assistant") {
            return [...t.slice(0, -1), { ...last, text: last.text ? `${last.text}\n\n${note}` : note }];
          }
          return [...t, { role: "assistant" as const, text: note }];
        });
      } finally {
        // If the stream ended cleanly but produced no text (tool-only turn or
        // silent server-side end), surface a minimal acknowledgement so the
        // user isn't staring at an empty JARVIS bubble.
        setTurns((t) => {
          const last = t[t.length - 1];
          if (last && last.role === "assistant" && last.text === "") {
            return [...t.slice(0, -1), { ...last, text: "Done." }];
          }
          return t;
        });
        setBusy(false);
        nudgeIdle(2000);
      }
    },
    [isBusy, nudgeIdle],
  );

  const focusCommand = useCallback(() => {
    setSeed((s) => ({ text: "", key: s.key + 1 }));
  }, []);

  const startErrand = useCallback(() => {
    setSeed((s) => ({ text: "Start an errand: ", key: s.key + 1 }));
  }, []);

  const addAutomation = useCallback(() => {
    setSeed((s) => ({ text: "Set up an automation that ", key: s.key + 1 }));
  }, []);

  const statusBullet = useMemo(() => {
    if (orb === "listening") return "LISTENING";
    if (orb === "thinking") return "THINKING";
    if (orb === "speaking") return "SPEAKING";
    return "READY";
  }, [orb]);

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background: "var(--bg)",
        color: "var(--ink)",
        position: "relative",
        overflowX: "hidden",
        fontFamily: "var(--sans)",
      }}
    >
      <div
        style={{
          position: "fixed",
          top: 28,
          left: 48,
          right: 48,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <StatusStrip
          listening
          pulse
          bullets={[statusBullet, clock ?? "—"]}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <TopNavLink href="/operations" label="Operations" />
          <TopNavLink href="/meetings" label="Meetings" />
          <TopNavLink href="/recall" label="Recall" />
          <TopNavLink href="/inbox" label="Inbox" />
          <TopNavLink href="/features" label="Features" />
          <TopNavLink href="/integrations" label="Integrations" />
          <TopNavLink href="/settings" label="Settings" />
          <button
            onClick={async () => {
              await supabaseBrowser().auth.signOut();
              window.location.href = "/login";
            }}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              color: "var(--ink-4)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      <div
        style={{
          position: "fixed",
          top: 72,
          right: 48,
          zIndex: 9,
        }}
      >
        <Orb state={orb} size={72} />
      </div>

      {!chatOpen && (
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "112px 32px 160px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 34,
              color: "var(--ink)",
              letterSpacing: "-0.5px",
              lineHeight: 1.1,
              marginBottom: 8,
            }}
          >
            {greeting}
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              color: "var(--ink-4)",
              marginBottom: 34,
            }}
          >
            Here&rsquo;s what JARVIS is doing
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              marginBottom: 28,
              flexWrap: "wrap",
            }}
          >
            <button onClick={startErrand} style={primaryCta}>
              Start an errand
            </button>
            <button onClick={addAutomation} style={secondaryCta}>
              Add an automation
            </button>
            <button onClick={focusCommand} style={secondaryCta}>
              Ask anything
            </button>
          </div>

          <LiveFeed onStartErrand={startErrand} onAddAutomation={addAutomation} />
        </div>
      )}

      {chatOpen && (
        <>
          <div
            style={{
              maxWidth: 720,
              margin: "0 auto",
              padding: "112px 32px 160px",
            }}
          >
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                letterSpacing: "1.4px",
                textTransform: "uppercase",
                color: "var(--ink-4)",
                marginBottom: 18,
              }}
            >
              Conversation
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {turns.map((t, i) => (
                <div
                  key={`t-${i}`}
                  style={{
                    fontFamily: "var(--sans)",
                    fontSize: 14.5,
                    lineHeight: 1.65,
                    color: t.role === "user" ? "var(--ink-3)" : "var(--ink)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10.5,
                      letterSpacing: "1.4px",
                      textTransform: "uppercase",
                      color: t.role === "user" ? "var(--ink-4)" : "var(--indigo)",
                      marginBottom: 6,
                    }}
                  >
                    {t.role === "user" ? "You" : "JARVIS"}
                  </div>
                  {t.role === "assistant" && t.text ? (
                    <Markdown>{t.text}</Markdown>
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap" }}>{t.text || (isBusy ? "…" : "")}</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              setChatOpen(false);
              setTurns([]);
              conversationIdRef.current = null;
            }}
            style={{
              position: "fixed",
              bottom: 104,
              left: 0,
              right: 0,
              textAlign: "center",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-4)",
              letterSpacing: "0.8px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              zIndex: 5,
            }}
          >
            ESC TO RETURN
          </button>
        </>
      )}

      <div
        style={{
          position: "fixed",
          bottom: 34,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
        }}
      >
        <CommandLine
          width={640}
          placeholder="Ask me anything, or tell me what to do."
          onSubmit={send}
          seed={seed.text}
          seedKey={seed.key}
        />
      </div>

      <Wordmark />

      {isBusy && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 24,
            zIndex: 10,
          }}
        >
          <Chip color="var(--indigo)" border="var(--indigo-soft)">
            {orb === "thinking" ? "Thinking" : orb === "speaking" ? "Speaking" : "Working"}
          </Chip>
        </div>
      )}
    </div>
  );
}

const primaryCta: React.CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 13.5,
  fontWeight: 500,
  color: "white",
  background: "var(--indigo)",
  border: "none",
  borderRadius: 10,
  padding: "10px 18px",
  cursor: "pointer",
  letterSpacing: "-0.1px",
};

const secondaryCta: React.CSSProperties = {
  fontFamily: "var(--sans)",
  fontSize: 13.5,
  fontWeight: 500,
  color: "var(--ink)",
  background: "transparent",
  border: "1px solid var(--rule)",
  borderRadius: 10,
  padding: "10px 18px",
  cursor: "pointer",
  letterSpacing: "-0.1px",
};

function TopNavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      style={{
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        letterSpacing: "1.4px",
        textTransform: "uppercase",
        color: "var(--ink-3)",
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}
