"use client";

import { useCallback, useEffect, useState } from "react";

type Idea = {
  id: string;
  text: string;
  kind: "product" | "content" | "venture" | "optimization" | "other";
  status: "fresh" | "exploring" | "shelved" | "adopted";
  heat: number;
  adopted_to: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const KIND_COLOR: Record<Idea["kind"], string> = {
  product: "#7affcb",
  content: "#f4c9d8",
  venture: "#bfd4ee",
  optimization: "#e6d3e8",
  other: "var(--rule)",
};

const KIND_LABEL: Record<Idea["kind"], string> = {
  product: "Product",
  content: "Content",
  venture: "Venture",
  optimization: "Optimisation",
  other: "Other",
};

const STATUS_LABEL: Record<Idea["status"], string> = {
  fresh: "Fresh",
  exploring: "Exploring",
  shelved: "Shelved",
  adopted: "Adopted",
};

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function IdeasConsole() {
  const [rows, setRows] = useState<Idea[]>([]);
  const [filter, setFilter] = useState<"active" | "fresh" | "exploring" | "shelved" | "adopted" | "all">("active");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Idea["kind"]>("product");
  const [heat, setHeat] = useState(3);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ideas?status=${filter}`);
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: Idea[] };
    setRows(json.rows ?? []);
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, kind, heat }),
      });
      if (res.ok) {
        setText("");
        setKind("product");
        setHeat(3);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    await fetch(`/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  };

  const remove = async (id: string) => {
    await fetch(`/api/ideas/${id}`, { method: "DELETE" });
    await load();
  };

  const filters: { id: typeof filter; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "fresh", label: "Fresh" },
    { id: "exploring", label: "Exploring" },
    { id: "adopted", label: "Adopted" },
    { id: "shelved", label: "Shelved" },
    { id: "all", label: "All" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: "8px 4px 80px" }}>
      <form
        onSubmit={submit}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: "18px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            letterSpacing: "1.6px",
            color: "var(--ink-3)",
            textTransform: "uppercase",
          }}
        >
          What if…
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A 60-second daily voice note that becomes a newsletter…"
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 18,
            padding: "10px 0",
            background: "transparent",
            border: "none",
            borderBottom: "1px solid var(--rule)",
            outline: "none",
            color: "var(--ink)",
          }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {(Object.keys(KIND_LABEL) as Idea["kind"][]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "4px 10px",
                borderRadius: 999,
                border: "1px solid var(--rule)",
                background: kind === k ? KIND_COLOR[k] : "transparent",
                color: kind === k ? "#0d0d10" : "var(--ink-2)",
                cursor: "pointer",
                letterSpacing: "0.4px",
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
          <span
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
            }}
          >
            HEAT
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setHeat(n)}
                aria-label={`Heat ${n}`}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  border: "1px solid var(--rule)",
                  background: heat >= n ? "#ff8a5c" : "transparent",
                  cursor: "pointer",
                }}
              />
            ))}
          </span>
          <button
            type="submit"
            disabled={!text.trim() || busy}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: text.trim() && !busy ? "var(--ink)" : "var(--surface-2)",
              color: text.trim() && !busy ? "var(--bg)" : "var(--ink-3)",
              cursor: text.trim() && !busy ? "pointer" : "default",
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            Capture
          </button>
        </div>
      </form>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid var(--rule)",
              background: filter === f.id ? "var(--ink)" : "transparent",
              color: filter === f.id ? "var(--bg)" : "var(--ink-2)",
              cursor: "pointer",
              letterSpacing: "0.4px",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: "60px 20px",
            textAlign: "center",
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 18,
            color: "var(--ink-3)",
          }}
        >
          Empty inbox. The next one might be worth a fortune.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onPatch={(body) => patch(idea.id, body)}
              onDelete={() => remove(idea.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function IdeaCard({
  idea,
  onPatch,
  onDelete,
}: {
  idea: Idea;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [adoptText, setAdoptText] = useState("");

  const tint = KIND_COLOR[idea.kind];
  const dim = idea.status === "shelved" || idea.status === "adopted";

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderLeft: `3px solid ${tint}`,
        borderRadius: 10,
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: dim ? 0.62 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 16,
            lineHeight: 1.4,
            color: "var(--ink)",
            flex: 1,
          }}
        >
          {idea.text}
        </div>
        <span
          style={{
            display: "flex",
            gap: 2,
            alignItems: "center",
            flexShrink: 0,
          }}
          title={`Heat ${idea.heat}/5`}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: idea.heat >= n ? "#ff8a5c" : "var(--rule)",
              }}
            />
          ))}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          letterSpacing: "0.4px",
        }}
      >
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            background: tint,
            color: "#0d0d10",
          }}
        >
          {KIND_LABEL[idea.kind].toUpperCase()}
        </span>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid var(--rule)",
          }}
        >
          {STATUS_LABEL[idea.status].toUpperCase()}
        </span>
        <span>{relTime(idea.created_at)}</span>
        {idea.adopted_to && (
          <span style={{ fontFamily: "var(--sans)", color: "var(--ink-2)" }}>
            → {idea.adopted_to}
          </span>
        )}
      </div>

      {idea.note && (
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13,
            color: "var(--ink-2)",
            lineHeight: 1.5,
            padding: "6px 10px",
            background: "var(--bg)",
            borderRadius: 6,
          }}
        >
          {idea.note}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {idea.status === "fresh" && (
          <ActionBtn label="Explore" onClick={() => onPatch({ status: "exploring" })} />
        )}
        {(idea.status === "fresh" || idea.status === "exploring") && (
          <>
            <ActionBtn label="Adopt" onClick={() => setAdoptOpen((o) => !o)} />
            <ActionBtn label="Shelf" onClick={() => onPatch({ status: "shelved" })} />
          </>
        )}
        {(idea.status === "shelved" || idea.status === "adopted") && (
          <ActionBtn label="Reopen" onClick={() => onPatch({ status: "exploring", adopted_to: null })} />
        )}
        <button
          onClick={onDelete}
          style={{
            marginLeft: "auto",
            fontFamily: "var(--mono)",
            fontSize: 11,
            background: "transparent",
            border: "none",
            color: "var(--ink-3)",
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>

      {adoptOpen && (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={adoptText}
            onChange={(e) => setAdoptText(e.target.value)}
            placeholder="Became goal: ship v1 / Became this week's deal / …"
            style={{
              flex: 1,
              fontFamily: "var(--sans)",
              fontSize: 13,
              padding: "6px 10px",
              border: "1px solid var(--rule)",
              borderRadius: 6,
              background: "var(--bg)",
              color: "var(--ink)",
              outline: "none",
            }}
          />
          <button
            onClick={async () => {
              await onPatch({ status: "adopted", adopted_to: adoptText.trim() || null });
              setAdoptOpen(false);
              setAdoptText("");
            }}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 12px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: "var(--ink)",
              color: "var(--bg)",
              cursor: "pointer",
              letterSpacing: "0.4px",
            }}
          >
            Adopt
          </button>
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--mono)",
        fontSize: 11,
        padding: "4px 10px",
        borderRadius: 6,
        border: "1px solid var(--rule)",
        background: "transparent",
        color: "var(--ink-2)",
        cursor: "pointer",
        letterSpacing: "0.4px",
      }}
    >
      {label}
    </button>
  );
}
