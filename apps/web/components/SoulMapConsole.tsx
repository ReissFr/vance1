"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Node = {
  id: string;
  kind: "identity" | "theme" | "policy" | "goal" | "decision" | "person";
  subkind?: string | null;
  label: string;
  weight: number;
  ref_id: string;
};

type Edge = {
  source: string;
  target: string;
  relation: "supports" | "tension" | "shapes" | "anchors" | "connects";
  strength: number;
  note: string;
};

type SoulMap = {
  id: string;
  nodes: Node[];
  edges: Edge[];
  centroid_summary: string | null;
  drift_summary: string | null;
  source_counts: Record<string, number>;
  parent_id: string | null;
  pinned: boolean;
  archived_at: string | null;
  user_note: string | null;
  created_at: string;
};

type Status = "active" | "pinned" | "archived" | "all";

const KIND_COLOR: Record<Node["kind"], string> = {
  identity: "#bfd4ee",
  theme: "#fbb86d",
  policy: "#9aa28e",
  goal: "#7affcb",
  decision: "#e8e0d2",
  person: "#f4c9d8",
};

const KIND_LABEL: Record<Node["kind"], string> = {
  identity: "identity",
  theme: "theme",
  policy: "policy",
  goal: "goal",
  decision: "decision",
  person: "person",
};

const REL_COLOR: Record<Edge["relation"], string> = {
  supports: "rgba(122,255,203,0.55)",
  tension: "rgba(255,107,107,0.65)",
  shapes: "rgba(251,184,109,0.55)",
  anchors: "rgba(244,201,216,0.55)",
  connects: "rgba(232,224,210,0.3)",
};

const REL_LABEL: Record<Edge["relation"], string> = {
  supports: "supports",
  tension: "tension",
  shapes: "shapes",
  anchors: "anchors",
  connects: "connects",
};

function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

export function SoulMapConsole() {
  const [maps, setMaps] = useState<SoulMap[]>([]);
  const [status, setStatus] = useState<Status>("active");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [decisionWindow, setDecisionWindow] = useState<number>(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [pinnedNote, setPinnedNote] = useState<{ from: string; to: string; rel: string; note: string } | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const [draftNote, setDraftNote] = useState("");

  const load = useCallback(async (s: Status) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/soul-maps?status=${s}&limit=40`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { maps: SoulMap[] };
      setMaps(j.maps ?? []);
      const first = j.maps?.[0];
      if (first && (!activeId || !j.maps.some((m) => m.id === activeId))) {
        setActiveId(first.id);
      } else if (!j.maps || j.maps.length === 0) {
        setActiveId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [activeId]);

  useEffect(() => { void load(status); }, [status, load]);

  const active = useMemo(() => maps.find((m) => m.id === activeId) ?? null, [maps, activeId]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch("/api/soul-maps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision_window_days: decisionWindow }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { map: SoulMap };
      setMaps((prev) => [j.map, ...prev]);
      setActiveId(j.map.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [decisionWindow]);

  const togglePin = useCallback(async (m: SoulMap) => {
    try {
      const r = await fetch(`/api/soul-maps/${m.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: !m.pinned }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { map: SoulMap };
      setMaps((prev) => prev.map((x) => (x.id === m.id ? j.map : x)));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const archive = useCallback(async (m: SoulMap) => {
    try {
      const r = await fetch(`/api/soul-maps/${m.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load(status);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [status, load]);

  const restore = useCallback(async (m: SoulMap) => {
    try {
      const r = await fetch(`/api/soul-maps/${m.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ restore: true }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await load(status);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [status, load]);

  const remove = useCallback(async (m: SoulMap) => {
    if (!confirm("Delete this map?")) return;
    try {
      await fetch(`/api/soul-maps/${m.id}`, { method: "DELETE" });
      await load(status);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [status, load]);

  const saveNote = useCallback(async () => {
    if (!active) return;
    try {
      const r = await fetch(`/api/soul-maps/${active.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_note: draftNote }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { map: SoulMap };
      setMaps((prev) => prev.map((x) => (x.id === active.id ? j.map : x)));
      setEditingNote(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [active, draftNote]);

  return (
    <div style={{ padding: "0 24px 80px", color: "#e8e0d2" }}>
      <div style={{
        marginTop: 16,
        padding: 18,
        border: "1px solid rgba(232,224,210,0.18)",
        background: "rgba(232,224,210,0.025)",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 18,
      }}>
        <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.18em", color: "rgba(232,224,210,0.5)" }}>DRAW A SOUL MAP</span>
          <span style={{ fontSize: 13, color: "rgba(232,224,210,0.7)" }}>I'll take your active identity, themes, policies, goals, recent decisions and important people, then infer the load-bearing edges between them.</span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[30, 90, 180, 365].map((d) => {
            const on = decisionWindow === d;
            return (
              <button
                key={d}
                onClick={() => setDecisionWindow(d)}
                style={{ padding: "6px 12px", background: on ? "#fbb86d" : "transparent", color: on ? "#181715" : "#fbb86d", border: "1px solid rgba(251,184,109,0.5)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
              >{d}d decisions</button>
            );
          })}
        </div>
        <button
          onClick={generate}
          disabled={generating}
          style={{
            padding: "10px 20px",
            background: generating ? "rgba(232,224,210,0.1)" : "#bfd4ee",
            color: generating ? "rgba(232,224,210,0.4)" : "#181715",
            border: "none",
            fontSize: 12,
            letterSpacing: "0.1em",
            fontWeight: 600,
            cursor: generating ? "not-allowed" : "pointer",
            textTransform: "uppercase",
          }}
        >{generating ? "Drawing…" : "Draw a map"}</button>
      </div>

      {error && (
        <div style={{ marginTop: 14, padding: 10, border: "1px solid #ff6b6b", color: "#ff6b6b", fontSize: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
        {(["active", "pinned", "archived", "all"] as const).map((s) => {
          const on = status === s;
          return (
            <button
              key={s}
              onClick={() => setStatus(s)}
              style={{ padding: "6px 14px", background: on ? "#e8e0d2" : "transparent", color: on ? "#181715" : "rgba(232,224,210,0.7)", border: "1px solid rgba(232,224,210,0.3)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
            >{s}</button>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 24, marginTop: 22 }}>
        <div style={{ position: "sticky", top: 80, alignSelf: "start", maxHeight: "calc(100vh - 100px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: "rgba(232,224,210,0.4)", fontSize: 12 }}>loading…</div>
          ) : maps.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: "rgba(232,224,210,0.4)", fontSize: 12 }}>no maps yet</div>
          ) : maps.map((m) => {
            const on = m.id === activeId;
            return (
              <button
                key={m.id}
                onClick={() => setActiveId(m.id)}
                style={{
                  padding: 12,
                  textAlign: "left",
                  background: on ? "rgba(191,212,238,0.08)" : "rgba(232,224,210,0.03)",
                  border: m.pinned ? "1px solid rgba(232,224,210,0.4)" : "1px solid rgba(232,224,210,0.1)",
                  borderLeft: on ? "3px solid #bfd4ee" : "3px solid transparent",
                  color: "#e8e0d2",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, letterSpacing: "0.1em", color: "rgba(232,224,210,0.5)" }}>{relTime(m.created_at)}</span>
                  {m.pinned && <span style={{ fontSize: 10, color: "rgba(232,224,210,0.5)" }}>★</span>}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: "rgba(232,224,210,0.6)" }}>{(m.nodes ?? []).length} nodes · {(m.edges ?? []).length} edges</div>
              </button>
            );
          })}
        </div>

        <div>
          {!active ? (
            <div style={{ padding: 60, textAlign: "center", color: "rgba(232,224,210,0.4)", fontSize: 13, border: "1px dashed rgba(232,224,210,0.15)" }}>
              draw your first soul map — I'll trace the load-bearing edges between who you've said you are, what you're chasing, and what you've actually been doing.
            </div>
          ) : (
            <div>
              {active.drift_summary && (
                <div style={{ marginBottom: 18, padding: 12, borderLeft: "3px solid #fbb86d", background: "rgba(251,184,109,0.04)", fontSize: 13, fontStyle: "italic", color: "rgba(232,224,210,0.85)" }}>
                  <span style={{ fontSize: 10, letterSpacing: "0.18em", color: "#fbb86d", display: "block", marginBottom: 4, fontStyle: "normal" }}>DRIFT</span>
                  {active.drift_summary}
                </div>
              )}

              <SoulMapCanvas
                nodes={active.nodes}
                edges={active.edges}
                onHoverNode={setHoverNode}
                hoverNode={hoverNode}
                onSelectEdge={(e) => {
                  const src = active.nodes.find((n) => n.id === e.source);
                  const tgt = active.nodes.find((n) => n.id === e.target);
                  setPinnedNote({ from: src?.label ?? e.source, to: tgt?.label ?? e.target, rel: REL_LABEL[e.relation], note: e.note });
                }}
              />

              {/* Legend */}
              <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11, color: "rgba(232,224,210,0.6)" }}>
                {(Object.keys(KIND_COLOR) as Node["kind"][]).map((k) => (
                  <span key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: KIND_COLOR[k] }} />
                    {KIND_LABEL[k]}
                  </span>
                ))}
                <span style={{ width: 1, height: 14, background: "rgba(232,224,210,0.2)" }} />
                {(Object.keys(REL_COLOR) as Edge["relation"][]).map((r) => (
                  <span key={r} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 14, height: 2, background: REL_COLOR[r] }} />
                    {REL_LABEL[r]}
                  </span>
                ))}
              </div>

              {pinnedNote && (
                <div style={{ marginTop: 12, padding: 12, border: "1px solid rgba(232,224,210,0.2)", background: "rgba(232,224,210,0.03)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, letterSpacing: "0.16em", color: "rgba(232,224,210,0.5)" }}>{pinnedNote.from} <span style={{ color: "#fbb86d" }}>{pinnedNote.rel}</span> {pinnedNote.to}</span>
                    <button onClick={() => setPinnedNote(null)} style={{ background: "transparent", border: "none", color: "rgba(232,224,210,0.5)", cursor: "pointer", fontSize: 14 }}>×</button>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 13, color: "#e8e0d2", fontStyle: "italic" }}>"{pinnedNote.note}"</div>
                </div>
              )}

              {/* Centroid summary */}
              {active.centroid_summary && (
                <div style={{ marginTop: 22, padding: 18, background: "rgba(232,224,210,0.04)", border: "1px solid rgba(232,224,210,0.15)" }}>
                  <span style={{ fontSize: 10, letterSpacing: "0.18em", color: "rgba(232,224,210,0.5)" }}>CENTROID</span>
                  <div style={{ marginTop: 8, fontFamily: "Georgia, serif", fontSize: 16, lineHeight: 1.7, color: "#e8e0d2" }}>{active.centroid_summary}</div>
                </div>
              )}

              {/* Source counts */}
              <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {Object.entries(active.source_counts ?? {}).map(([k, v]) => (
                  <span key={k} style={{ padding: "3px 10px", border: "1px solid rgba(232,224,210,0.2)", fontSize: 11, color: "rgba(232,224,210,0.6)" }}>{v} {k}</span>
                ))}
              </div>

              {/* Action row */}
              <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ padding: "6px 12px", fontSize: 11, color: "rgba(232,224,210,0.5)" }}>Drawn {relTime(active.created_at)}</span>
                <button
                  onClick={() => togglePin(active)}
                  style={{ padding: "6px 12px", background: "transparent", color: active.pinned ? "#fbb86d" : "rgba(232,224,210,0.7)", border: "1px solid rgba(232,224,210,0.3)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}
                >{active.pinned ? "★ Pinned" : "Pin"}</button>
                {active.archived_at ? (
                  <button onClick={() => restore(active)} style={{ padding: "6px 12px", background: "transparent", color: "#bfd4ee", border: "1px solid rgba(191,212,238,0.4)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}>Restore</button>
                ) : (
                  <button onClick={() => archive(active)} style={{ padding: "6px 12px", background: "transparent", color: "rgba(232,224,210,0.6)", border: "1px solid rgba(232,224,210,0.2)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}>Archive</button>
                )}
                <button onClick={() => remove(active)} style={{ padding: "6px 12px", background: "transparent", color: "rgba(232,224,210,0.4)", border: "1px solid rgba(232,224,210,0.15)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em", marginLeft: "auto" }}>Delete</button>
              </div>

              {/* User note */}
              <div style={{ marginTop: 14 }}>
                {editingNote ? (
                  <div>
                    <textarea
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      placeholder="Your reaction to this map…"
                      style={{ width: "100%", minHeight: 80, padding: 10, background: "rgba(232,224,210,0.04)", border: "1px solid rgba(232,224,210,0.2)", color: "#e8e0d2", fontSize: 13, fontFamily: "inherit", resize: "vertical" }}
                    />
                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      <button onClick={() => { setEditingNote(false); }} style={{ padding: "6px 12px", background: "transparent", color: "rgba(232,224,210,0.7)", border: "1px solid rgba(232,224,210,0.3)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}>Cancel</button>
                      <button onClick={saveNote} style={{ padding: "6px 12px", background: "#bfd4ee", color: "#181715", border: "none", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>Save</button>
                    </div>
                  </div>
                ) : active.user_note ? (
                  <div style={{ padding: 12, borderLeft: "3px solid #bfd4ee", background: "rgba(191,212,238,0.04)", fontStyle: "italic", fontSize: 13, color: "rgba(232,224,210,0.85)" }}>
                    "{active.user_note}"
                    <button onClick={() => { setDraftNote(active.user_note ?? ""); setEditingNote(true); }} style={{ marginLeft: 12, background: "transparent", border: "none", color: "rgba(232,224,210,0.5)", cursor: "pointer", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em" }}>Edit</button>
                  </div>
                ) : (
                  <button onClick={() => { setDraftNote(""); setEditingNote(true); }} style={{ padding: "8px 14px", background: "transparent", border: "1px dashed rgba(232,224,210,0.3)", color: "rgba(232,224,210,0.5)", fontSize: 11, cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.1em" }}>+ React to this map</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Force-directed canvas ----
type Sim = { id: string; x: number; y: number; vx: number; vy: number; node: Node };

function SoulMapCanvas({
  nodes,
  edges,
  hoverNode,
  onHoverNode,
  onSelectEdge,
}: {
  nodes: Node[];
  edges: Edge[];
  hoverNode: string | null;
  onHoverNode: (id: string | null) => void;
  onSelectEdge: (e: Edge) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim[]>([]);
  const animRef = useRef<number | null>(null);
  const lastClickPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  // initialise sim
  useEffect(() => {
    const cw = 720;
    const ch = 540;
    simRef.current = nodes.map((n, i) => {
      const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      return {
        id: n.id,
        x: cw / 2 + Math.cos(angle) * 200 + (Math.random() - 0.5) * 30,
        y: ch / 2 + Math.sin(angle) * 200 + (Math.random() - 0.5) * 30,
        vx: 0,
        vy: 0,
        node: n,
      };
    });
  }, [nodes]);

  // simulation + render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const idIndex = new Map(simRef.current.map((s, i) => [s.id, i]));

    const tick = () => {
      const sims = simRef.current;
      const n = sims.length;
      const repulsion = 5500;
      const springLen = 130;
      const springK = 0.012;
      const damping = 0.85;
      const centerK = 0.0009;

      for (let i = 0; i < n; i++) {
        const a = sims[i];
        if (!a) continue;
        for (let j = i + 1; j < n; j++) {
          const b = sims[j];
          if (!b) continue;
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { d2 = 1; dx = (Math.random() - 0.5) * 1; dy = (Math.random() - 0.5) * 1; }
          const f = repulsion / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
        }
      }

      for (const e of edges) {
        const ai = idIndex.get(e.source);
        const bi = idIndex.get(e.target);
        if (ai == null || bi == null) continue;
        const a = sims[ai];
        const b = sims[bi];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const restLen = springLen - e.strength * 8;
        const f = (d - restLen) * springK * (0.6 + e.strength * 0.15);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }

      for (const s of sims) {
        s.vx += (cw / 2 - s.x) * centerK;
        s.vy += (ch / 2 - s.y) * centerK;
        s.vx *= damping;
        s.vy *= damping;
        s.x += s.vx;
        s.y += s.vy;
        s.x = Math.max(40, Math.min(cw - 40, s.x));
        s.y = Math.max(40, Math.min(ch - 40, s.y));
      }

      ctx.clearRect(0, 0, cw, ch);

      // edges
      for (const e of edges) {
        const a = sims[idIndex.get(e.source) ?? -1];
        const b = sims[idIndex.get(e.target) ?? -1];
        if (!a || !b) continue;
        ctx.strokeStyle = REL_COLOR[e.relation];
        ctx.lineWidth = 0.6 + e.strength * 0.5;
        if (e.relation === "tension") ctx.setLineDash([4, 4]);
        else ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // nodes
      for (const s of sims) {
        const r = 6 + s.node.weight * 2.4;
        const isHover = hoverNode === s.id;
        ctx.beginPath();
        ctx.fillStyle = KIND_COLOR[s.node.kind];
        ctx.globalAlpha = isHover ? 1 : 0.92;
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (isHover) {
          ctx.strokeStyle = "#e8e0d2";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // label
        ctx.fillStyle = isHover ? "#e8e0d2" : "rgba(232,224,210,0.8)";
        ctx.font = `${isHover ? 12 : 11}px ui-sans-serif, system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const label = s.node.label.length > 22 ? s.node.label.slice(0, 21) + "…" : s.node.label;
        ctx.fillText(label, s.x, s.y + r + 4);
      }

      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
    };
  }, [nodes, edges, hoverNode]);

  // mouse interaction
  const handlePointerMove = useCallback((evt: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (evt.target as HTMLCanvasElement).getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;

    if (dragRef.current) {
      const sim = simRef.current.find((s) => s.id === dragRef.current?.id);
      if (sim) {
        sim.x = x - dragRef.current.offsetX;
        sim.y = y - dragRef.current.offsetY;
        sim.vx = 0;
        sim.vy = 0;
      }
      return;
    }

    let closest: Sim | null = null;
    let closestD2 = Infinity;
    for (const s of simRef.current) {
      const r = 6 + s.node.weight * 2.4;
      const dx = s.x - x;
      const dy = s.y - y;
      const d2 = dx * dx + dy * dy;
      const hitR = (r + 4) * (r + 4);
      if (d2 < hitR && d2 < closestD2) { closest = s; closestD2 = d2; }
    }
    onHoverNode(closest ? closest.id : null);
  }, [onHoverNode]);

  const handlePointerDown = useCallback((evt: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = (evt.target as HTMLCanvasElement).getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    lastClickPosRef.current = { x, y };

    for (const s of simRef.current) {
      const r = 6 + s.node.weight * 2.4;
      const dx = s.x - x;
      const dy = s.y - y;
      if (dx * dx + dy * dy < (r + 4) * (r + 4)) {
        dragRef.current = { id: s.id, offsetX: x - s.x, offsetY: y - s.y };
        (evt.target as HTMLCanvasElement).setPointerCapture(evt.pointerId);
        return;
      }
    }
  }, []);

  const handlePointerUp = useCallback((evt: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      dragRef.current = null;
      (evt.target as HTMLCanvasElement).releasePointerCapture(evt.pointerId);
      return;
    }
    // click on edge?
    const rect = (evt.target as HTMLCanvasElement).getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;

    let bestEdge: Edge | null = null;
    let bestD = 8;
    const idIndex = new Map(simRef.current.map((s, i) => [s.id, i]));
    for (const e of edges) {
      const ai = idIndex.get(e.source);
      const bi = idIndex.get(e.target);
      if (ai == null || bi == null) continue;
      const a = simRef.current[ai];
      const b = simRef.current[bi];
      if (!a || !b) continue;
      const d = pointToSegDistance(x, y, a.x, a.y, b.x, b.y);
      if (d < bestD) { bestD = d; bestEdge = e; }
    }
    if (bestEdge) onSelectEdge(bestEdge);
  }, [edges, onSelectEdge]);

  return (
    <div style={{ position: "relative", border: "1px solid rgba(232,224,210,0.15)", background: "#0e0d0c", borderRadius: 2 }}>
      <canvas
        ref={canvasRef}
        width={720}
        height={540}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => onHoverNode(null)}
        style={{ display: "block", width: "100%", height: "auto", touchAction: "none", cursor: hoverNode ? "grab" : "default" }}
      />
    </div>
  );
}

function pointToSegDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ddx = px - cx;
  const ddy = py - cy;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}
