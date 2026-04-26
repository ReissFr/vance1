"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Person = {
  id: string;
  name: string;
  relation: string;
  importance: number;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  notes: string | null;
  tags: string[];
  last_interaction_at: string | null;
  reconnect_every_days: number | null;
  created_at: string;
  updated_at: string;
};

type Interaction = {
  id: string;
  kind: string;
  summary: string;
  sentiment: string | null;
  occurred_at: string;
  created_at: string;
};

const RELATIONS = [
  "friend",
  "family",
  "team",
  "customer",
  "prospect",
  "investor",
  "founder",
  "mentor",
  "vendor",
  "press",
  "other",
] as const;

const KINDS = [
  "call",
  "meeting",
  "email",
  "dm",
  "whatsapp",
  "sms",
  "event",
  "intro",
  "other",
] as const;

const RELATION_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "customer", label: "Customers" },
  { id: "investor", label: "Investors" },
  { id: "founder", label: "Founders" },
  { id: "team", label: "Team" },
  { id: "mentor", label: "Mentors" },
  { id: "friend", label: "Friends" },
  { id: "family", label: "Family" },
  { id: "prospect", label: "Prospects" },
  { id: "vendor", label: "Vendors" },
  { id: "press", label: "Press" },
  { id: "other", label: "Other" },
];

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days < 1) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function isOverdue(p: Person): boolean {
  if (!p.reconnect_every_days) return false;
  if (!p.last_interaction_at) return true;
  const ms = Date.now() - new Date(p.last_interaction_at).getTime();
  return ms > p.reconnect_every_days * 86400000;
}

function importanceDot(n: number): string {
  if (n === 1) return "#7affcb";
  if (n === 2) return "var(--ink-3)";
  return "var(--ink-3)";
}

function importanceLabel(n: number): string {
  if (n === 1) return "high";
  if (n === 3) return "low";
  return "med";
}

export function PeopleConsole() {
  const [rows, setRows] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [relationFilter, setRelationFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);

  const [newName, setNewName] = useState("");
  const [newRelation, setNewRelation] = useState<string>("other");
  const [newImportance, setNewImportance] = useState<number>(2);
  const [newEmail, setNewEmail] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newReconnect, setNewReconnect] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (relationFilter !== "all") params.set("relation", relationFilter);
    const url = params.toString() ? `/api/people?${params.toString()}` : "/api/people";
    const res = await fetch(url);
    if (!res.ok) return;
    const json = (await res.json()) as { rows?: Person[] };
    setRows(json.rows ?? []);
  }, [search, relationFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setInteractions([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/people/${selectedId}/interactions`);
      if (!res.ok) return;
      const json = (await res.json()) as { rows?: Interaction[] };
      if (!cancelled) setInteractions(json.rows ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const selected = useMemo(
    () => rows.find((p) => p.id === selectedId) ?? null,
    [rows, selectedId],
  );

  const overdueCount = useMemo(
    () => rows.filter((p) => isOverdue(p)).length,
    [rows],
  );

  const submitPerson = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = newName.trim();
    if (!n || busy) return;
    setBusy(true);
    try {
      const reconnect = newReconnect.trim() ? Number(newReconnect.trim()) : null;
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: n,
          relation: newRelation,
          importance: newImportance,
          email: newEmail.trim() || null,
          company: newCompany.trim() || null,
          role: newRole.trim() || null,
          notes: newNotes.trim() || null,
          reconnect_every_days: reconnect,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { person?: Person };
        setNewName("");
        setNewRelation("other");
        setNewImportance(2);
        setNewEmail("");
        setNewCompany("");
        setNewRole("");
        setNewReconnect("");
        setNewNotes("");
        setShowNew(false);
        await load();
        if (json.person) setSelectedId(json.person.id);
      }
    } finally {
      setBusy(false);
    }
  };

  const removePerson = async (id: string) => {
    if (!confirm("Delete this person and their interaction history?")) return;
    await fetch(`/api/people/${id}`, { method: "DELETE" });
    if (selectedId === id) setSelectedId(null);
    await load();
  };

  const patchPerson = async (id: string, payload: Record<string, unknown>) => {
    await fetch(`/api/people/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    await load();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "8px 4px 80px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, company, role, email"
          style={{
            flex: 1,
            minWidth: 240,
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            padding: "8px 12px",
            border: "1px solid var(--rule)",
            borderRadius: 8,
            background: "var(--bg)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        <button
          onClick={() => setShowNew((v) => !v)}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--rule)",
            background: showNew ? "var(--surface-2)" : "var(--ink)",
            color: showNew ? "var(--ink-2)" : "var(--bg)",
            cursor: "pointer",
            letterSpacing: "0.6px",
            textTransform: "uppercase",
          }}
        >
          {showNew ? "Cancel" : "+ Person"}
        </button>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: overdueCount > 0 ? "#f4a3a3" : "var(--ink-3)",
            letterSpacing: "1.4px",
          }}
        >
          {rows.length} ppl{overdueCount > 0 ? ` · ${overdueCount} overdue` : ""}
        </span>
      </div>

      {showNew && (
        <form
          onSubmit={submitPerson}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: 14,
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 12,
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
            New person
          </div>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            autoFocus
            style={inputStyle}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              value={newRelation}
              onChange={(e) => setNewRelation(e.target.value)}
              style={selectStyle}
            >
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 4 }}>
              {[1, 2, 3].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setNewImportance(n)}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--rule)",
                    background: newImportance === n ? "var(--ink)" : "transparent",
                    color: newImportance === n ? "var(--bg)" : "var(--ink-2)",
                    cursor: "pointer",
                    letterSpacing: "0.4px",
                  }}
                >
                  {importanceLabel(n)}
                </button>
              ))}
            </div>
            <input
              value={newReconnect}
              onChange={(e) => setNewReconnect(e.target.value)}
              placeholder="reconnect every N days (optional)"
              style={{ ...inputStyle, flex: 1, minWidth: 220 }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="email"
              style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            />
            <input
              value={newCompany}
              onChange={(e) => setNewCompany(e.target.value)}
              placeholder="company"
              style={{ ...inputStyle, flex: 1, minWidth: 140 }}
            />
            <input
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              placeholder="role"
              style={{ ...inputStyle, flex: 1, minWidth: 140 }}
            />
          </div>
          <textarea
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Notes (how you met, what they care about, what they're working on)"
            rows={3}
            style={{ ...inputStyle, fontFamily: "var(--sans)", lineHeight: 1.5, resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="submit"
              disabled={!newName.trim() || busy}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid var(--rule)",
                background: newName.trim() && !busy ? "var(--ink)" : "var(--surface-2)",
                color: newName.trim() && !busy ? "var(--bg)" : "var(--ink-3)",
                cursor: newName.trim() && !busy ? "pointer" : "default",
                letterSpacing: "0.6px",
                textTransform: "uppercase",
              }}
            >
              Save
            </button>
          </div>
        </form>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {RELATION_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setRelationFilter(f.id)}
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 999,
              border: "1px solid var(--rule)",
              background: relationFilter === f.id ? "var(--ink)" : "transparent",
              color: relationFilter === f.id ? "var(--bg)" : "var(--ink-2)",
              cursor: "pointer",
              letterSpacing: "0.4px",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.length === 0 ? (
            <div
              style={{
                padding: "60px 20px",
                textAlign: "center",
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 17,
                color: "var(--ink-3)",
              }}
            >
              No one logged yet. The relationships you don't tend, fade.
            </div>
          ) : (
            rows.map((p) => {
              const overdue = isOverdue(p);
              const active = selectedId === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    background: active ? "var(--surface-2)" : "var(--surface)",
                    border: `1px solid ${active ? "var(--ink-3)" : "var(--rule)"}`,
                    borderLeft: overdue ? "3px solid #f4a3a3" : `1px solid ${active ? "var(--ink-3)" : "var(--rule)"}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: importanceDot(p.importance),
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontFamily: "var(--sans)", fontSize: 14, color: "var(--ink)", fontWeight: 500 }}>
                      {p.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--mono)",
                        fontSize: 10,
                        padding: "1px 6px",
                        borderRadius: 4,
                        border: "1px solid var(--rule)",
                        color: "var(--ink-3)",
                        letterSpacing: "0.3px",
                      }}
                    >
                      {p.relation}
                    </span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontFamily: "var(--mono)",
                        fontSize: 10.5,
                        color: overdue ? "#f4a3a3" : "var(--ink-3)",
                        letterSpacing: "0.3px",
                      }}
                    >
                      {relTime(p.last_interaction_at)}
                      {overdue ? " ·overdue" : ""}
                    </span>
                  </div>
                  {(p.company || p.role) && (
                    <div style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>
                      {[p.role, p.company].filter(Boolean).join(" · ")}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div style={{ position: "sticky", top: 12, alignSelf: "flex-start" }}>
          {selected ? (
            <PersonPanel
              person={selected}
              interactions={interactions}
              onChange={async () => {
                await load();
                const r = await fetch(`/api/people/${selected.id}/interactions`);
                if (r.ok) {
                  const j = (await r.json()) as { rows?: Interaction[] };
                  setInteractions(j.rows ?? []);
                }
              }}
              onPatch={(payload) => patchPerson(selected.id, payload)}
              onDelete={() => removePerson(selected.id)}
            />
          ) : (
            <div
              style={{
                padding: "40px 20px",
                textAlign: "center",
                fontFamily: "var(--serif)",
                fontStyle: "italic",
                fontSize: 16,
                color: "var(--ink-3)",
                background: "var(--surface)",
                border: "1px solid var(--rule)",
                borderRadius: 12,
              }}
            >
              Select someone to log an interaction or read history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonPanel({
  person,
  interactions,
  onChange,
  onPatch,
  onDelete,
}: {
  person: Person;
  interactions: Interaction[];
  onChange: () => Promise<void>;
  onPatch: (payload: Record<string, unknown>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [kind, setKind] = useState<string>("other");
  const [summary, setSummary] = useState("");
  const [sentiment, setSentiment] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [editReconnect, setEditReconnect] = useState(person.reconnect_every_days?.toString() ?? "");
  const [editImportance, setEditImportance] = useState(person.importance);
  const [editRelation, setEditRelation] = useState(person.relation);

  useEffect(() => {
    setEditReconnect(person.reconnect_every_days?.toString() ?? "");
    setEditImportance(person.importance);
    setEditRelation(person.relation);
  }, [person.id, person.reconnect_every_days, person.importance, person.relation]);

  const submitInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    const s = summary.trim();
    if (!s || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/people/${person.id}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          summary: s,
          sentiment,
          occurred_at: occurredAt || null,
        }),
      });
      if (res.ok) {
        setSummary("");
        setSentiment(null);
        setOccurredAt("");
        setKind("other");
        await onChange();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 12,
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontFamily: "var(--serif)", fontSize: 22, color: "var(--ink)" }}>{person.name}</span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "0.4px",
            }}
          >
            {person.relation} · {importanceLabel(person.importance)} importance
          </span>
          <button
            onClick={() => setEditingMeta((v) => !v)}
            style={{
              marginLeft: "auto",
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              padding: "3px 8px",
              borderRadius: 5,
              border: "1px solid var(--rule)",
              background: "transparent",
              color: "var(--ink-3)",
              cursor: "pointer",
            }}
          >
            {editingMeta ? "close" : "edit"}
          </button>
          <button
            onClick={onDelete}
            style={{
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
        {(person.company || person.role || person.email || person.phone) && (
          <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--ink-2)" }}>
            {[person.role, person.company].filter(Boolean).join(" · ")}
            {person.email ? ` · ${person.email}` : ""}
            {person.phone ? ` · ${person.phone}` : ""}
          </div>
        )}
        {person.notes && (
          <div
            style={{
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 14,
              color: "var(--ink-2)",
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
            }}
          >
            {person.notes}
          </div>
        )}
        {editingMeta && (
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              padding: "10px 0 0",
              borderTop: "1px solid var(--rule-soft)",
            }}
          >
            <select
              value={editRelation}
              onChange={(e) => {
                setEditRelation(e.target.value);
                void onPatch({ relation: e.target.value });
              }}
              style={selectStyle}
            >
              {RELATIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 4 }}>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setEditImportance(n);
                    void onPatch({ importance: n });
                  }}
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 11,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--rule)",
                    background: editImportance === n ? "var(--ink)" : "transparent",
                    color: editImportance === n ? "var(--bg)" : "var(--ink-2)",
                    cursor: "pointer",
                  }}
                >
                  {importanceLabel(n)}
                </button>
              ))}
            </div>
            <input
              value={editReconnect}
              onChange={(e) => setEditReconnect(e.target.value)}
              onBlur={() => {
                const n = editReconnect.trim() ? Number(editReconnect.trim()) : null;
                void onPatch({ reconnect_every_days: n });
              }}
              placeholder="reconnect every N days"
              style={{ ...inputStyle, width: 200 }}
            />
          </div>
        )}
      </div>

      <form
        onSubmit={submitInteraction}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 12,
          padding: "14px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
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
          Log interaction
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {KINDS.map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setKind(k)}
              style={{
                fontFamily: "var(--mono)",
                fontSize: 11,
                padding: "4px 9px",
                borderRadius: 999,
                border: "1px solid var(--rule)",
                background: kind === k ? "var(--ink)" : "transparent",
                color: kind === k ? "var(--bg)" : "var(--ink-2)",
                cursor: "pointer",
                letterSpacing: "0.4px",
              }}
            >
              {k}
            </button>
          ))}
        </div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What happened? What did they say? What did you commit to?"
          rows={3}
          style={{ ...inputStyle, fontFamily: "var(--sans)", lineHeight: 1.5, resize: "vertical" }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {[
              { id: "positive", label: "+", colour: "#7affcb" },
              { id: "neutral", label: "0", colour: "var(--ink-3)" },
              { id: "negative", label: "−", colour: "#f4a3a3" },
            ].map((s) => (
              <button
                type="button"
                key={s.id}
                onClick={() => setSentiment(sentiment === s.id ? null : s.id)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 12,
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  background: sentiment === s.id ? s.colour : "transparent",
                  color: sentiment === s.id ? "var(--bg)" : "var(--ink-2)",
                  cursor: "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            style={{ ...inputStyle, width: 200 }}
          />
          <button
            type="submit"
            disabled={!summary.trim() || busy}
            style={{
              marginLeft: "auto",
              fontFamily: "var(--mono)",
              fontSize: 11,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--rule)",
              background: summary.trim() && !busy ? "var(--ink)" : "var(--surface-2)",
              color: summary.trim() && !busy ? "var(--bg)" : "var(--ink-3)",
              cursor: summary.trim() && !busy ? "pointer" : "default",
              letterSpacing: "0.6px",
              textTransform: "uppercase",
            }}
          >
            Log
          </button>
        </div>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {interactions.length === 0 ? (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              fontFamily: "var(--serif)",
              fontStyle: "italic",
              fontSize: 14,
              color: "var(--ink-3)",
            }}
          >
            No interactions logged yet.
          </div>
        ) : (
          interactions.map((it) => (
            <div
              key={it.id}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--rule)",
                borderRadius: 8,
                padding: "10px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 4,
                    border: "1px solid var(--rule)",
                    color: "var(--ink-3)",
                    letterSpacing: "0.3px",
                  }}
                >
                  {it.kind}
                </span>
                {it.sentiment && (
                  <span
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: 10,
                      color:
                        it.sentiment === "positive"
                          ? "#7affcb"
                          : it.sentiment === "negative"
                            ? "#f4a3a3"
                            : "var(--ink-3)",
                    }}
                  >
                    {it.sentiment}
                  </span>
                )}
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "var(--mono)",
                    fontSize: 10.5,
                    color: "var(--ink-3)",
                  }}
                >
                  {new Date(it.occurred_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 13.5,
                  color: "var(--ink-2)",
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                }}
              >
                {it.summary}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 12.5,
  padding: "8px 10px",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--ink)",
  outline: "none",
  letterSpacing: "0.3px",
};

const selectStyle: React.CSSProperties = {
  fontFamily: "var(--mono)",
  fontSize: 12.5,
  padding: "7px 10px",
  border: "1px solid var(--rule)",
  borderRadius: 6,
  background: "var(--bg)",
  color: "var(--ink)",
  outline: "none",
  textTransform: "lowercase",
};
