"use client";

import { useCallback, useEffect, useState } from "react";
import { ContactsIndex } from "./ContactsIndex";

type Direction = "outbound" | "inbound";

interface Commitment {
  id: string;
  direction: Direction;
  other_party: string;
  other_party_email: string | null;
  commitment_text: string;
  deadline: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  source_kind: string | null;
  source_meeting_title: string | null;
}

interface Meeting {
  id: string;
  title: string | null;
  started_at: string;
  summary: string | null;
}

interface RecallHit {
  id: string;
  source: string;
  title: string | null;
  snippet: string;
  occurred_at: string;
}

interface Reliability {
  outbound: { delivered: number; lapsed: number; ratio: number | null };
  inbound: { delivered: number; lapsed: number; ratio: number | null };
}

interface Profile {
  email: string;
  name: string | null;
  commitments: { open: Commitment[]; closed: Commitment[] };
  meetings: Meeting[];
  recall: RecallHit[];
  reliability: Reliability;
}

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 16,
  marginBottom: 14,
};

const SECTION_TITLE: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 11,
  letterSpacing: 1,
  color: "var(--ink-3)",
  marginBottom: 10,
  textTransform: "uppercase",
};

export function ContactProfileConsole() {
  const [email, setEmail] = useState("");
  const [committedEmail, setCommittedEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Pre-seed from ?email=… so deep links work.
    if (typeof window === "undefined") return;
    const p = new URL(window.location.href).searchParams.get("email");
    if (p) {
      setEmail(p);
      setCommittedEmail(p);
    }
  }, []);

  const fetchProfile = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    setProfile(null);
    try {
      const r = await fetch(`/api/contacts/profile?email=${encodeURIComponent(q)}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const body = (await r.json()) as Profile;
      setProfile(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (committedEmail) void fetchProfile(committedEmail);
  }, [committedEmail, fetchProfile]);

  function pickEmail(v: string) {
    const clean = v.trim().toLowerCase();
    if (!clean.includes("@")) return;
    setEmail(clean);
    setCommittedEmail(clean);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("email", clean);
      window.history.replaceState({}, "", url.toString());
    }
  }

  function clearEmail() {
    setEmail("");
    setCommittedEmail(null);
    setProfile(null);
    setError(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("email");
      window.history.replaceState({}, "", url.toString());
    }
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    pickEmail(email);
  }

  // Index mode: no email yet.
  if (!committedEmail) {
    return (
      <div style={{ padding: "8px 0" }}>
        <form onSubmit={onSubmit} style={{ ...CARD, display: "flex", gap: 8 }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Jump to email — ana.ruiz@acme.co"
            style={{
              flex: 1,
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--ink)",
              fontFamily: "var(--mono)",
              fontSize: 13,
              padding: "8px 10px",
            }}
          />
          <button
            type="submit"
            style={{
              background: "var(--indigo)",
              border: "none",
              borderRadius: 4,
              color: "white",
              cursor: "pointer",
              fontFamily: "var(--mono)",
              fontSize: 11,
              letterSpacing: 0.5,
              padding: "8px 14px",
              textTransform: "uppercase",
            }}
          >
            Lookup
          </button>
        </form>
        <ContactsIndex onPick={pickEmail} />
      </div>
    );
  }

  // Profile mode.
  return (
    <div style={{ padding: "8px 0" }}>
      <div
        style={{
          ...CARD,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          onClick={clearEmail}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--ink-2)",
            cursor: "pointer",
            fontFamily: "var(--mono)",
            fontSize: 10,
            letterSpacing: 0.5,
            padding: "5px 10px",
            textTransform: "uppercase",
          }}
        >
          ← All contacts
        </button>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 12,
            color: "var(--ink-3)",
          }}
        >
          {committedEmail}
        </div>
      </div>

      {loading && <div style={{ ...CARD, color: "var(--ink-3)" }}>loading…</div>}
      {error && !loading && (
        <div style={{ ...CARD, color: "#ff6b6b" }}>failed to load: {error}</div>
      )}
      {!loading && !error && !profile && (
        <div style={{ ...CARD, color: "var(--ink-3)" }}>no data for {committedEmail}.</div>
      )}

      {profile && <ProfileBody profile={profile} />}
    </div>
  );
}

function ProfileBody({ profile }: { profile: Profile }) {
  const name = profile.name ?? profile.email.split("@")[0];
  const hasAny =
    profile.commitments.open.length > 0 ||
    profile.commitments.closed.length > 0 ||
    profile.meetings.length > 0 ||
    profile.recall.length > 0;

  return (
    <>
      <div style={CARD}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 20,
            color: "var(--ink)",
            fontWeight: 500,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            marginTop: 4,
          }}
        >
          {profile.email}
        </div>
        <ReliabilityRow reliability={profile.reliability} />
      </div>

      {!hasAny && (
        <div style={{ ...CARD, color: "var(--ink-3)" }}>
          No commitments, meetings or emails on record with this contact yet.
        </div>
      )}

      {profile.commitments.open.length > 0 && (
        <div style={CARD}>
          <div style={SECTION_TITLE}>Open promises · {profile.commitments.open.length}</div>
          {profile.commitments.open.map((c) => (
            <CommitmentRow key={c.id} c={c} />
          ))}
        </div>
      )}

      {profile.commitments.closed.length > 0 && (
        <div style={CARD}>
          <div style={SECTION_TITLE}>History · {profile.commitments.closed.length}</div>
          {profile.commitments.closed.slice(0, 15).map((c) => (
            <CommitmentRow key={c.id} c={c} muted />
          ))}
        </div>
      )}

      {profile.meetings.length > 0 && (
        <div style={CARD}>
          <div style={SECTION_TITLE}>Meetings · {profile.meetings.length}</div>
          {profile.meetings.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "8px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                    width: 88,
                  }}
                >
                  {new Date(m.started_at).toLocaleDateString()}
                </span>
                <span style={{ color: "var(--ink)", fontSize: 13 }}>
                  {m.title ?? "(untitled)"}
                </span>
              </div>
              {m.summary && (
                <div
                  style={{
                    color: "var(--ink-3)",
                    fontSize: 12,
                    marginLeft: 98,
                    lineHeight: 1.4,
                  }}
                >
                  {m.summary.slice(0, 240)}
                  {m.summary.length > 240 ? "…" : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {profile.recall.length > 0 && (
        <div style={CARD}>
          <div style={SECTION_TITLE}>Recent recall · {profile.recall.length}</div>
          {profile.recall.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                padding: "8px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    color: "var(--indigo)",
                    width: 58,
                    textTransform: "uppercase",
                  }}
                >
                  {r.source}
                </span>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    color: "var(--ink-3)",
                  }}
                >
                  {new Date(r.occurred_at).toLocaleDateString()}
                </span>
                {r.title && (
                  <span style={{ color: "var(--ink)", fontSize: 13 }}>{r.title}</span>
                )}
              </div>
              <div
                style={{
                  color: "var(--ink-3)",
                  fontSize: 12,
                  marginLeft: 68,
                  lineHeight: 1.4,
                }}
              >
                {r.snippet}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function CommitmentRow({ c, muted = false }: { c: Commitment; muted?: boolean }) {
  const [nudgeState, setNudgeState] = useState<
    | { kind: "idle" }
    | { kind: "drafting" }
    | { kind: "done"; url: string }
    | { kind: "error"; msg: string }
  >({ kind: "idle" });

  const isOverdueInbound =
    !muted &&
    c.direction === "inbound" &&
    c.status === "open" &&
    c.deadline != null &&
    new Date(c.deadline) < new Date() &&
    c.other_party_email != null;

  const nudge = useCallback(async () => {
    setNudgeState({ kind: "drafting" });
    try {
      const r = await fetch("/api/contacts/nudge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commitment_id: c.id }),
      });
      const j = (await r.json()) as { open_url?: string; error?: string };
      if (!r.ok || !j.open_url) {
        throw new Error(j.error ?? `http ${r.status}`);
      }
      setNudgeState({ kind: "done", url: j.open_url });
      if (typeof window !== "undefined") window.open(j.open_url, "_blank");
    } catch (e) {
      setNudgeState({
        kind: "error",
        msg: e instanceof Error ? e.message : "nudge failed",
      });
    }
  }, [c.id]);

  return (
    <div
      style={{
        padding: "8px 0",
        borderTop: "1px solid var(--border)",
        opacity: muted ? 0.65 : 1,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: c.direction === "outbound" ? "#ffb86b" : "#7affcb",
            width: 78,
            textTransform: "uppercase",
          }}
        >
          {c.direction === "outbound" ? "You owe" : "They owe"}
        </span>
        <span style={{ color: "var(--ink)", fontSize: 13, flex: 1 }}>
          {c.commitment_text}
        </span>
        {c.deadline && (
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-3)",
            }}
          >
            {new Date(c.deadline).toLocaleDateString()}
          </span>
        )}
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--ink-3)",
            textTransform: "uppercase",
          }}
        >
          {c.status}
        </span>
        {isOverdueInbound && nudgeState.kind !== "done" && (
          <button
            onClick={nudge}
            disabled={nudgeState.kind === "drafting"}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--ink-2)",
              cursor: nudgeState.kind === "drafting" ? "wait" : "pointer",
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            {nudgeState.kind === "drafting" ? "drafting…" : "Nudge"}
          </button>
        )}
        {nudgeState.kind === "done" && (
          <a
            href={nudgeState.url}
            target="_blank"
            rel="noreferrer"
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              color: "#7affcb",
              textDecoration: "none",
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            Drafted →
          </a>
        )}
      </div>
      {nudgeState.kind === "error" && (
        <div
          style={{
            marginLeft: 88,
            marginTop: 4,
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "#ff6b6b",
          }}
        >
          {nudgeState.msg}
        </div>
      )}
    </div>
  );
}

function ReliabilityRow({ reliability }: { reliability: Reliability }) {
  const lines: string[] = [];
  const inbound = reliability.inbound;
  if (inbound.ratio != null) {
    lines.push(
      `They deliver ${Math.round(inbound.ratio * 100)}% of promises (${inbound.delivered}/${inbound.delivered + inbound.lapsed})`,
    );
  }
  const outbound = reliability.outbound;
  if (outbound.ratio != null) {
    lines.push(
      `You deliver ${Math.round(outbound.ratio * 100)}% to them (${outbound.delivered}/${outbound.delivered + outbound.lapsed})`,
    );
  }
  if (lines.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 10,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        fontFamily: "var(--mono)",
        fontSize: 11,
        color: "var(--ink-2)",
      }}
    >
      {lines.map((l, i) => (
        <div key={i}>· {l}</div>
      ))}
    </div>
  );
}
