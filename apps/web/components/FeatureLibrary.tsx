"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { isTauri } from "@/lib/tauri";

type Category = "agent" | "integration" | "sensor" | "skill" | "automation" | "scheduled";
type Tier = "free" | "pro" | "business";
type Requirement = "desktop" | "gmail" | "calendar" | "stripe" | "banking" | "home" | "twilio";

interface FeatureItem {
  id: string;
  category: Category;
  name: string;
  tagline: string;
  description: string;
  icon: string;
  tier: Tier;
  requires: Requirement[];
  defaultEnabled: boolean;
  enabled: boolean;
  available: boolean;
  missingRequirements: Requirement[];
}

const CATEGORY_LABELS: Record<Category | "all", string> = {
  all: "All",
  agent: "Agents",
  integration: "Integrations",
  sensor: "Sensors",
  skill: "Skills",
  automation: "Automations",
  scheduled: "Scheduled",
};

const REQ_LABELS: Record<Requirement, string> = {
  desktop: "Desktop app",
  gmail: "Gmail",
  calendar: "Calendar",
  stripe: "Stripe",
  banking: "Bank account",
  home: "Smart home",
  twilio: "WhatsApp number",
};

export function FeatureLibrary() {
  const [items, setItems] = useState<FeatureItem[] | null>(null);
  const [category, setCategory] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FeatureItem | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inDesktop, setInDesktop] = useState(false);

  useEffect(() => {
    setInDesktop(isTauri());
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/features");
      if (!r.ok) {
        setError(`Failed to load (${r.status})`);
        return;
      }
      const d = (await r.json()) as { features: FeatureItem[] };
      setItems(d.features);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = useCallback(async (f: FeatureItem, next: boolean) => {
    setPendingId(f.id);
    setError(null);
    const prev = items;
    setItems((xs) => xs?.map((x) => (x.id === f.id ? { ...x, enabled: next } : x)) ?? xs);
    try {
      const r = await fetch("/api/features/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ featureId: f.id, enabled: next }),
      });
      if (!r.ok) {
        setItems(prev);
        setError(`Toggle failed (${r.status})`);
      }
    } catch (e) {
      setItems(prev);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingId(null);
    }
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items.filter((f) => {
      if (category !== "all" && f.category !== category) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.tagline.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q)
      );
    });
  }, [items, category, query]);

  const counts = useMemo(() => {
    const base = { all: 0, agent: 0, integration: 0, sensor: 0, skill: 0, automation: 0, scheduled: 0 } as Record<Category | "all", number>;
    for (const f of items ?? []) {
      base.all += 1;
      base[f.category] += 1;
    }
    return base;
  }, [items]);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Feature library</h1>
            <p className="mt-1 text-sm text-white/60">
              Turn JARVIS&apos;s agents, integrations, and sensors on or off.
            </p>
          </div>
          <Link href="/" className="text-xs text-white/60 hover:text-white/90">
            ← back to chat
          </Link>
        </header>

        <div className="mb-6 flex flex-wrap items-center gap-2">
          {(Object.keys(CATEGORY_LABELS) as (Category | "all")[]).map((k) => (
            <button
              key={k}
              onClick={() => setCategory(k)}
              className={`rounded-full border px-3 py-1 text-xs ${
                category === k
                  ? "border-white bg-white text-black"
                  : "border-white/20 text-white/80 hover:border-white/40"
              }`}
            >
              {CATEGORY_LABELS[k]} <span className="opacity-60">({counts[k]})</span>
            </button>
          ))}
          <div className="flex-1" />
          <input
            placeholder="Search features…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-56 rounded-md border border-white/20 bg-transparent px-3 py-1.5 text-xs placeholder-white/30 focus:border-white/60 focus:outline-none"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {!items ? (
          <div className="py-20 text-center text-sm text-white/40">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center text-sm text-white/40">No features match.</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((f) => {
              const desktopGated = f.requires.includes("desktop") && !inDesktop;
              const blocked = !f.available || desktopGated;
              return (
                <div
                  key={f.id}
                  className="group flex flex-col rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/30"
                >
                  <button
                    onClick={() => setSelected(f)}
                    className="flex items-start gap-3 text-left"
                  >
                    <div className="text-2xl">{f.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium">{f.name}</div>
                        {f.tier !== "free" && (
                          <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                            {f.tier}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-white/60 line-clamp-2">{f.tagline}</div>
                    </div>
                  </button>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-[11px] text-white/40">
                      {desktopGated
                        ? "Requires desktop app"
                        : blocked
                          ? `Requires: ${f.missingRequirements.map((r) => REQ_LABELS[r]).join(", ")}`
                          : f.enabled
                            ? "Enabled"
                            : "Disabled"}
                    </div>
                    <Toggle
                      checked={f.enabled}
                      disabled={blocked || pendingId === f.id}
                      onChange={(next) => toggle(f, next)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selected && (
        <Drawer feature={selected} onClose={() => setSelected(null)} onToggle={toggle} pending={pendingId === selected.id} inDesktop={inDesktop} />
      )}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
        disabled
          ? "cursor-not-allowed bg-white/10"
          : checked
            ? "bg-emerald-400"
            : "bg-white/20"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function Drawer({
  feature,
  onClose,
  onToggle,
  pending,
  inDesktop,
}: {
  feature: FeatureItem;
  onClose: () => void;
  onToggle: (f: FeatureItem, next: boolean) => void;
  pending: boolean;
  inDesktop: boolean;
}) {
  const desktopGated = feature.requires.includes("desktop") && !inDesktop;
  const blocked = !feature.available || desktopGated;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-lg rounded-t-2xl border border-white/10 bg-neutral-950 p-6 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className="text-3xl">{feature.icon}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">{feature.name}</h2>
              {feature.tier !== "free" && (
                <span className="rounded-full bg-amber-400/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                  {feature.tier}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-white/50 uppercase tracking-wide">{feature.category}</div>
          </div>
          <button onClick={onClose} className="text-white/50 hover:text-white">✕</button>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-white/80">{feature.description}</p>

        {feature.requires.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] uppercase tracking-wide text-white/40">Requires</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {feature.requires.map((r) => {
                const missing = feature.missingRequirements.includes(r) || (r === "desktop" && !inDesktop);
                return (
                  <span
                    key={r}
                    className={`rounded-full px-2 py-0.5 text-[11px] ${
                      missing
                        ? "bg-red-500/15 text-red-200"
                        : "bg-emerald-500/15 text-emerald-200"
                    }`}
                  >
                    {REQ_LABELS[r]}{missing ? " · missing" : ""}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <div className="text-xs text-white/60">
            {blocked
              ? "Connect the missing requirements to enable."
              : feature.enabled
                ? "Enabled for your account."
                : "Disabled for your account."}
          </div>
          <Toggle
            checked={feature.enabled}
            disabled={blocked || pending}
            onChange={(next) => onToggle(feature, next)}
          />
        </div>
      </div>
    </div>
  );
}
