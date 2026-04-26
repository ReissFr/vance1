"use client";

import { useEffect, useState } from "react";

interface ContactRow {
  email: string;
  name: string | null;
  open_count: number;
  closed_count: number;
  overdue_count: number;
  last_interaction_at: string | null;
  reliability: number | null;
}

const CARD: React.CSSProperties = {
  background: "var(--panel)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 16,
  marginBottom: 14,
};

function relative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.round(diff / (24 * 60 * 60_000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(days / 365);
  return `${years}y ago`;
}

export function ContactsIndex({ onPick }: { onPick: (email: string) => void }) {
  const [rows, setRows] = useState<ContactRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/contacts/index", { cache: "no-store" });
        if (!r.ok) throw new Error(`${r.status}`);
        const body = (await r.json()) as { contacts: ContactRow[] };
        if (!cancelled) setRows(body.contacts);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div style={{ ...CARD, color: "#ff6b6b" }}>failed to load: {error}</div>;
  }
  if (rows === null) {
    return <div style={{ ...CARD, color: "var(--ink-3)" }}>loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <div style={{ ...CARD, color: "var(--ink-3)" }}>
        No counterparties on record yet. Commitments, meetings, and recall events will
        populate this list as JARVIS sees them.
      </div>
    );
  }

  const q = filter.trim().toLowerCase();
  const visible = q
    ? rows.filter(
        (r) =>
          r.email.includes(q) || (r.name ? r.name.toLowerCase().includes(q) : false),
      )
    : rows;

  return (
    <>
      <div style={{ ...CARD, padding: 10 }}>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${rows.length} contact${rows.length === 1 ? "" : "s"}…`}
          style={{
            width: "100%",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 4,
            color: "var(--ink)",
            fontFamily: "var(--mono)",
            fontSize: 12,
            padding: "8px 10px",
          }}
        />
      </div>

      <div style={CARD}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 60px 60px 90px 80px",
            gap: 10,
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "var(--ink-3)",
            letterSpacing: 1,
            textTransform: "uppercase",
            paddingBottom: 8,
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>Contact</div>
          <div style={{ textAlign: "right" }}>Open</div>
          <div style={{ textAlign: "right" }}>Over</div>
          <div style={{ textAlign: "right" }}>Last</div>
          <div style={{ textAlign: "right" }}>Deliv.</div>
        </div>
        {visible.map((r) => (
          <button
            key={r.email}
            onClick={() => onPick(r.email)}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 60px 60px 90px 80px",
              gap: 10,
              alignItems: "baseline",
              width: "100%",
              background: "transparent",
              border: "none",
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              padding: "10px 0",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <div style={{ minWidth: 0, overflow: "hidden" }}>
              <div
                style={{
                  color: "var(--ink)",
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.name ?? r.email.split("@")[0]}
              </div>
              <div
                style={{
                  color: "var(--ink-3)",
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {r.email}
              </div>
            </div>
            <div
              style={{
                textAlign: "right",
                fontFamily: "var(--mono)",
                fontSize: 13,
                color: r.open_count > 0 ? "var(--ink)" : "var(--ink-3)",
              }}
            >
              {r.open_count || ""}
            </div>
            <div
              style={{
                textAlign: "right",
                fontFamily: "var(--mono)",
                fontSize: 13,
                color: r.overdue_count > 0 ? "#ff6b6b" : "var(--ink-3)",
              }}
            >
              {r.overdue_count || ""}
            </div>
            <div
              style={{
                textAlign: "right",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              {relative(r.last_interaction_at)}
            </div>
            <div
              style={{
                textAlign: "right",
                fontFamily: "var(--mono)",
                fontSize: 11,
                color: "var(--ink-3)",
              }}
            >
              {r.reliability == null ? "—" : `${Math.round(r.reliability * 100)}%`}
            </div>
          </button>
        ))}
        {q && visible.length === 0 && (
          <div
            style={{
              padding: "16px 0",
              color: "var(--ink-3)",
              fontFamily: "var(--mono)",
              fontSize: 12,
            }}
          >
            No contacts match "{filter}".
          </div>
        )}
      </div>
    </>
  );
}
