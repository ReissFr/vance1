"use client";

// LiveFeed: the activity dashboard that leads the home screen. Shows what
// JARVIS is doing right now (errands, armed automations, upcoming wakes,
// things paused on the user, recent proactive actions) so the user sees the
// always-on moat before they ever type. Chat is a secondary surface.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type FeedItem = {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  at?: string;
  href?: string;
};

type FeedResponse = {
  active: FeedItem[];
  armed: FeedItem[];
  upcoming: FeedItem[];
  needsYou: FeedItem[];
  recent: FeedItem[];
};

type SectionDef = {
  label: string;
  items: FeedItem[];
  emphasis?: "primary" | "secondary";
};

export function LiveFeed({
  onStartErrand,
  onAddAutomation,
}: {
  onStartErrand?: () => void;
  onAddAutomation?: () => void;
}) {
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/home/feed", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as FeedResponse;
      setFeed(body);
    } catch {
      // best effort — feed is non-blocking
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const sections: SectionDef[] = feed
    ? ([
        { label: "Needs you", items: feed.needsYou, emphasis: "primary" },
        { label: "Active now", items: feed.active, emphasis: "primary" },
        { label: "Armed", items: feed.armed },
        { label: "Upcoming", items: feed.upcoming },
        { label: "Recent", items: feed.recent, emphasis: "secondary" },
      ] satisfies SectionDef[]).filter((s) => s.items.length > 0)
    : [];

  const anyActivity = sections.length > 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 22,
        width: "100%",
      }}
    >
      {!loaded && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.4px",
            textTransform: "uppercase",
            color: "var(--ink-4)",
            textAlign: "center",
            padding: 20,
          }}
        >
          Loading…
        </div>
      )}

      {loaded && !anyActivity && (
        <IdleState onStartErrand={onStartErrand} onAddAutomation={onAddAutomation} />
      )}

      {sections.map((s) => (
        <FeedSection key={s.label} label={s.label} emphasis={s.emphasis}>
          {s.items.map((item) => (
            <FeedCard key={`${s.label}-${item.id}`} item={item} />
          ))}
        </FeedSection>
      ))}
    </div>
  );
}

function FeedSection({
  label,
  emphasis,
  children,
}: {
  label: string;
  emphasis?: "primary" | "secondary";
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.4px",
          textTransform: "uppercase",
          color:
            emphasis === "primary"
              ? "var(--indigo)"
              : emphasis === "secondary"
                ? "var(--ink-4)"
                : "var(--ink-3)",
          marginBottom: 10,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </section>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const body = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        padding: "14px 18px",
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14.5,
            color: "var(--ink)",
            letterSpacing: "-0.1px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </div>
        {item.subtitle && (
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink-3)",
              marginTop: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {item.subtitle}
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 9.5,
          letterSpacing: "1px",
          textTransform: "uppercase",
          color: "var(--ink-4)",
          flexShrink: 0,
        }}
      >
        {kindLabel(item.kind)}
      </div>
    </div>
  );
  if (item.href) {
    return (
      <Link href={item.href} style={{ textDecoration: "none" }}>
        {body}
      </Link>
    );
  }
  return body;
}

function IdleState({
  onStartErrand,
  onAddAutomation,
}: {
  onStartErrand?: () => void;
  onAddAutomation?: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--rule)",
        borderRadius: 18,
        background: "var(--surface)",
        padding: "36px 32px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 24,
          letterSpacing: "-0.3px",
          color: "var(--ink)",
          marginBottom: 10,
        }}
      >
        Nothing running yet.
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          color: "var(--ink-3)",
          marginBottom: 22,
          maxWidth: 440,
          margin: "0 auto 22px",
          lineHeight: 1.55,
        }}
      >
        Give JARVIS something to drive, or a rule to fire on. It runs while you&rsquo;re away.
      </div>
      <div
        style={{
          display: "flex",
          gap: 12,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <button onClick={onStartErrand} style={primaryBtn}>
          Start an errand
        </button>
        <button onClick={onAddAutomation} style={secondaryBtn}>
          Add an automation
        </button>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
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

const secondaryBtn: React.CSSProperties = {
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

function kindLabel(kind: string): string {
  const [head, tail] = kind.split(":");
  if (!tail) return head ?? "";
  if (head === "task") return tail;
  if (head === "automation") return tail;
  if (head === "scheduled") return "scheduled";
  if (head === "approval") return "waiting";
  if (head === "run") return "fired";
  if (head === "proactive") return tail === "call" ? "called" : "messaged";
  return tail;
}
