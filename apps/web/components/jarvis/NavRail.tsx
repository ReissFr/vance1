"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = {
  id: string;
  href: string;
  label: string;
  key: string;
  badge?: number;
  live?: boolean;
};

const items: Item[] = [
  { id: "home", href: "/", label: "Home", key: "H" },
  { id: "today", href: "/today", label: "Today", key: "T" },
  { id: "ops", href: "/operations", label: "Operations", key: "O" },
  { id: "watch", href: "/watchers", label: "Watchers", key: "W" },
  { id: "mtg", href: "/meetings", label: "Meetings", key: "M" },
  { id: "recall", href: "/recall", label: "Recall", key: "R" },
  { id: "mem", href: "/memory", label: "Memory", key: "E" },
  { id: "inbox", href: "/inbox", label: "Inbox", key: "I" },
  { id: "places", href: "/places", label: "Places", key: "P" },
  { id: "sites", href: "/sites", label: "Sites", key: "S" },
  { id: "feat", href: "/features", label: "Features", key: "F" },
  { id: "rcpt", href: "/receipts", label: "Receipts", key: "C" },
  { id: "bud", href: "/budgets", label: "Budgets", key: "U" },
  { id: "sub", href: "/subscriptions", label: "Subscriptions", key: "V" },
  { id: "mny", href: "/money", label: "Money", key: "Q" },
  { id: "cmt", href: "/commitments", label: "Commitments", key: "B" },
  { id: "cnt", href: "/contacts", label: "Contacts", key: "D" },
  { id: "hab", href: "/habits", label: "Habits", key: "J" },
  { id: "focus", href: "/focus", label: "Focus", key: "." },
  { id: "read", href: "/reading", label: "Reading", key: ";" },
  { id: "chk", href: "/checkins", label: "Check-ins", key: "'" },
  { id: "intn", href: "/intentions", label: "Intentions", key: "[" },
  { id: "dec", href: "/decisions", label: "Decisions", key: "]" },
  { id: "bday", href: "/birthdays", label: "Birthdays", key: "\\" },
  { id: "win", href: "/wins", label: "Wins", key: "=" },
  { id: "goal", href: "/goals", label: "Goals", key: "-" },
  { id: "idea", href: "/ideas", label: "Ideas", key: "/" },
  { id: "qst", href: "/questions", label: "Questions", key: "`" },
  { id: "rfl", href: "/reflections", label: "Reflections", key: "1" },
  { id: "lps", href: "/loops", label: "Open loops", key: "2" },
  { id: "prm", href: "/prompts", label: "Prompts", key: "3" },
  { id: "ppl", href: "/people", label: "People", key: "4" },
  { id: "crd", href: "/cards", label: "Cards", key: "5" },
  { id: "voi", href: "/voice", label: "Voice", key: "6" },
  { id: "stn", href: "/standup", label: "Standup", key: "7" },
  { id: "rtn", href: "/routines", label: "Routines", key: "8" },
  { id: "rtr", href: "/retrospective", label: "Retrospective", key: "9" },
  { id: "thm", href: "/themes", label: "Themes", key: "0" },
  { id: "hist", href: "/history", label: "History", key: "Y" },
  { id: "err", href: "/errors", label: "Errors", key: "X" },
  { id: "anl", href: "/analytics", label: "Analytics", key: "N" },
  { id: "ins", href: "/insights", label: "Insights", key: "Z" },
  { id: "cost", href: "/costs", label: "Costs", key: "L" },
  { id: "auto", href: "/automations", label: "Automations", key: "A" },
  { id: "skl", href: "/skills", label: "Skills", key: "K" },
  { id: "int", href: "/integrations", label: "Integrations", key: "G" },
];

type Props = {
  badges?: Partial<Record<string, number>>;
  live?: Partial<Record<string, boolean>>;
  user?: { name: string; tag?: string };
};

export function NavRail({ badges, live, user }: Props) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname?.startsWith(href);

  return (
    <nav
      style={{
        width: 220,
        background: "var(--surface)",
        borderRight: "1px solid var(--rule)",
        padding: "28px 14px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
      }}
    >
      <div
        style={{
          padding: "0 12px 26px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background:
              "conic-gradient(from 0deg, #f4c9d8, #cfdcea, #e6d3e8, #f4c9d8)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            letterSpacing: "2.2px",
            color: "var(--ink-2)",
          }}
        >
          JARVIS
        </span>
      </div>

      {items.map((x) => {
        const active = isActive(x.href);
        const badge = badges?.[x.id];
        const isLive = live?.[x.id];
        return (
          <Link
            key={x.id}
            href={x.href}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 12px",
              background: active ? "var(--surface-2)" : "transparent",
              borderRadius: 8,
              cursor: "pointer",
              color: active ? "var(--ink)" : "var(--ink-2)",
              fontFamily: "var(--sans)",
              fontSize: 13.5,
              fontWeight: active ? 500 : 400,
              textDecoration: "none",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: active ? "var(--indigo)" : "var(--ink-3)",
                animation: isLive ? "jv-pulse 1.2s ease-in-out infinite" : "none",
              }}
            />
            <span style={{ flex: 1 }}>{x.label}</span>
            {badge != null && (
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  color: "var(--indigo)",
                  letterSpacing: "0.4px",
                }}
              >
                {String(badge).padStart(2, "0")}
              </span>
            )}
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                padding: "2px 5px",
                borderRadius: 4,
                background: active ? "var(--bg)" : "transparent",
                color: "var(--ink-3)",
                letterSpacing: "0.4px",
                border: `1px solid ${active ? "var(--rule)" : "transparent"}`,
              }}
            >
              {x.key}
            </span>
          </Link>
        );
      })}

      <Link
        href="/settings"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          marginTop: 2,
          color: "var(--ink-2)",
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          textDecoration: "none",
          borderRadius: 8,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--ink-3)",
          }}
        />
        <span style={{ flex: 1 }}>Settings</span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            padding: "2px 5px",
            borderRadius: 4,
            color: "var(--ink-3)",
            letterSpacing: "0.4px",
          }}
        >
          ,
        </span>
      </Link>

      <div
        style={{
          marginTop: "auto",
          padding: "16px 12px 6px",
          borderTop: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #f4c9d8, #bfd4ee)",
            border: "1px solid var(--rule)",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink)",
              fontWeight: 500,
            }}
          >
            {user?.name ?? "Reiss"}
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
            }}
          >
            {user?.tag ?? "v0.9 · SOLO"}
          </div>
        </div>
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 11,
          color: "var(--ink-3)",
          padding: "8px 12px 0",
          lineHeight: 1.5,
          fontStyle: "italic",
        }}
      >
        I never send without asking.
      </div>
    </nav>
  );
}
