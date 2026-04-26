"use client";

import { useEffect, useState } from "react";

interface InstalledSkill {
  name: string;
  description: string;
  dir: string;
}

type LearnedStatus = "unverified" | "verified" | "deprecated" | "flagged";

interface LearnedSkill {
  id: string;
  name: string;
  description: string;
  site: string | null;
  status: LearnedStatus;
  version: number;
  verified_count: number;
  failed_count: number;
  last_verified_at: string | null;
  last_failed_at: string | null;
  created_at: string;
}

const STATUS_COLOR: Record<LearnedStatus, string> = {
  verified: "#7affcb",
  unverified: "#ffd27a",
  deprecated: "#c49cff",
  flagged: "#ff6b6b",
};

function successRate(s: LearnedSkill): string {
  const total = s.verified_count + s.failed_count;
  if (total === 0) return "no runs";
  const pct = Math.round((s.verified_count / total) * 100);
  return `${pct}% · ${total} run${total === 1 ? "" : "s"}`;
}

export function SkillsConsole() {
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [learned, setLearned] = useState<LearnedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"installed" | "learned">("installed");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/skills", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as {
            installed: InstalledSkill[];
            learned: LearnedSkill[];
          };
          setInstalled(data.installed ?? []);
          setLearned(data.learned ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div style={{ padding: "28px 32px 40px", maxWidth: 960 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 22 }}>
        <TabPill
          label={`Installed · ${installed.length}`}
          active={tab === "installed"}
          onClick={() => setTab("installed")}
        />
        <TabPill
          label={`Learned · ${learned.length}`}
          active={tab === "learned"}
          onClick={() => setTab("learned")}
        />
      </div>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: 18,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.6px",
            textTransform: "uppercase",
            color: "var(--ink-3)",
            marginBottom: 8,
          }}
        >
          {tab === "installed" ? "What installed means" : "What learned means"}
        </div>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13,
            color: "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          {tab === "installed"
            ? "Installed skills are recipes I can follow — written as markdown by you or imported from the skills registry. Ask me to \"find a skill for X\" to install more."
            : "Learned skills are things I figured out while doing your work — browser flows, site automations. They're replayable so the same task goes faster next time."}
        </div>
      </div>

      {loading ? (
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Loading…</div>
      ) : tab === "installed" ? (
        <InstalledList skills={installed} />
      ) : (
        <LearnedList skills={learned} />
      )}
    </div>
  );
}

function TabPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 999,
        fontSize: 12,
        fontFamily: "var(--sans)",
        border: `1px solid ${active ? "var(--ink)" : "var(--rule)"}`,
        background: active ? "var(--ink)" : "transparent",
        color: active ? "#000" : "var(--ink-2)",
        cursor: "pointer",
        fontWeight: active ? 500 : 400,
      }}
    >
      {label}
    </button>
  );
}

function InstalledList({ skills }: { skills: InstalledSkill[] }) {
  if (skills.length === 0) {
    return (
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
        No skills installed yet. Say "find a skill for …" in the command line.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {skills.map((s) => (
        <div
          key={s.name}
          style={{
            padding: "14px 16px",
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: 12,
          }}
        >
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--ink)",
              marginBottom: 4,
            }}
          >
            {s.name}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-2)",
              lineHeight: 1.55,
              marginBottom: 8,
            }}
          >
            {s.description}
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
            }}
          >
            {s.dir.replace(process.env.NEXT_PUBLIC_SKILLS_ROOT ?? "", "")}
          </div>
        </div>
      ))}
    </div>
  );
}

function LearnedList({ skills }: { skills: LearnedSkill[] }) {
  if (skills.length === 0) {
    return (
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
        No learned skills yet. Once I succeed at a site task a few times, I'll start saving the recipe.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {skills.map((s) => (
        <div
          key={s.id}
          style={{
            padding: "14px 16px",
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: 12,
            display: "flex",
            gap: 14,
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              width: 4,
              alignSelf: "stretch",
              borderRadius: 2,
              background: STATUS_COLOR[s.status],
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--sans)",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--ink)",
                marginBottom: 4,
              }}
            >
              {s.name}
            </div>
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ink-2)",
                lineHeight: 1.55,
                marginBottom: 8,
              }}
            >
              {s.description}
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                fontFamily: "var(--mono)",
                fontSize: 10.5,
                color: "var(--ink-3)",
                letterSpacing: "0.4px",
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: STATUS_COLOR[s.status], textTransform: "uppercase" }}>
                {s.status}
              </span>
              {s.site && <span>{s.site}</span>}
              <span>v{s.version}</span>
              <span>{successRate(s)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
