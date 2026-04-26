"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ROUTES: Record<string, { path: string; label: string }> = {
  h: { path: "/", label: "Home" },
  t: { path: "/today", label: "Today" },
  o: { path: "/operations", label: "Operations" },
  w: { path: "/watchers", label: "Watchers" },
  m: { path: "/meetings", label: "Meetings" },
  r: { path: "/recall", label: "Recall" },
  e: { path: "/memory", label: "Memory" },
  i: { path: "/inbox", label: "Inbox" },
  p: { path: "/places", label: "Places" },
  s: { path: "/sites", label: "Sites" },
  f: { path: "/features", label: "Features" },
  c: { path: "/receipts", label: "Receipts" },
  u: { path: "/budgets", label: "Budgets" },
  v: { path: "/subscriptions", label: "Subscriptions" },
  b: { path: "/commitments", label: "Commitments" },
  d: { path: "/contacts", label: "Contacts" },
  j: { path: "/habits", label: "Habits" },
  y: { path: "/history", label: "History" },
  x: { path: "/errors", label: "Errors" },
  n: { path: "/analytics", label: "Analytics" },
  z: { path: "/insights", label: "Insights" },
  l: { path: "/costs", label: "Costs" },
  a: { path: "/automations", label: "Automations" },
  k: { path: "/skills", label: "Skills" },
  g: { path: "/integrations", label: "Integrations" },
  ".": { path: "/focus", label: "Focus" },
  ";": { path: "/reading", label: "Reading" },
  "'": { path: "/checkins", label: "Check-ins" },
  "[": { path: "/intentions", label: "Intentions" },
  "]": { path: "/decisions", label: "Decisions" },
  "\\": { path: "/birthdays", label: "Birthdays" },
  "=": { path: "/wins", label: "Wins" },
  "-": { path: "/goals", label: "Goals" },
  "/": { path: "/ideas", label: "Ideas" },
  "`": { path: "/questions", label: "Questions" },
  "1": { path: "/reflections", label: "Reflections" },
  "2": { path: "/loops", label: "Open loops" },
  "3": { path: "/prompts", label: "Prompts" },
  "4": { path: "/people", label: "People" },
  "5": { path: "/cards", label: "Cards" },
  "6": { path: "/voice", label: "Voice" },
  "7": { path: "/standup", label: "Standup" },
  "8": { path: "/routines", label: "Routines" },
  "9": { path: "/retrospective", label: "Retrospective" },
  "0": { path: "/themes", label: "Themes" },
  ",": { path: "/settings", label: "Settings" },
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function GlobalShortcuts() {
  const router = useRouter();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        return;
      }

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }

      if (e.shiftKey) return;

      const key = e.key.toLowerCase();
      const dest = ROUTES[key];
      if (dest) {
        e.preventDefault();
        router.push(dest.path);
        if (helpOpen) setHelpOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [router, helpOpen]);

  if (!helpOpen) return null;

  const entries = Object.entries(ROUTES);

  return (
    <div
      onClick={() => setHelpOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 95,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(560px, 100%)",
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 16,
          boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
          padding: "22px 24px 18px",
          fontFamily: "var(--sans)",
          color: "var(--ink)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 22,
              letterSpacing: "-0.2px",
            }}
          >
            Keyboard shortcuts
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.4px",
              color: "var(--ink-3)",
              textTransform: "uppercase",
            }}
          >
            ? to toggle · esc to close
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "6px 24px",
          }}
        >
          {entries.map(([k, { label }]) => (
            <Row key={k} keyLabel={k.toUpperCase()} label={label} />
          ))}
          <Row keyLabel="⌘K" label="Command palette" />
          <Row keyLabel="?" label="This help" />
        </div>
      </div>
    </div>
  );
}

function Row({ keyLabel, label }: { keyLabel: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "7px 0",
        borderBottom: "1px solid var(--rule-soft)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          padding: "3px 7px",
          background: "var(--bg)",
          color: "var(--ink-2)",
          border: "1px solid var(--rule)",
          borderRadius: 5,
          minWidth: 28,
          textAlign: "center",
          letterSpacing: "0.4px",
        }}
      >
        {keyLabel}
      </span>
      <span
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          color: "var(--ink-2)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
