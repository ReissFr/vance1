"use client";

// /sites — one-tap pre-sign-in to the services JARVIS drives via browser_*
// tools. Clicking a button POSTs to /api/sites/open, which pops the login
// URL in JARVIS's persistent Chromium. The user signs in once; cookies
// survive in ~/.jarvis/browser-profile across every future task.

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/jarvis/primitives";

const STORAGE_KEY = "jarvis.sites.connected.v1";

type Connected = Record<string, string>; // site id -> ISO timestamp

function loadConnected(): Connected {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Connected;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveConnected(c: Connected) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* swallow */
  }
}

function formatAge(iso: string): string {
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const h = mins / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

type Site = {
  id: string;
  name: string;
  url: string;
  tagline: string;
};

type Category = {
  title: string;
  sites: Site[];
};

const CATEGORIES: Category[] = [
  {
    title: "Rides",
    sites: [
      {
        id: "uber",
        name: "Uber",
        url: "https://auth.uber.com/login/",
        tagline: "Cabs",
      },
      {
        id: "bolt",
        name: "Bolt",
        url: "https://bolt.eu/en/",
        tagline: "Cabs · cheaper",
      },
    ],
  },
  {
    title: "Food",
    sites: [
      {
        id: "deliveroo",
        name: "Deliveroo",
        url: "https://deliveroo.co.uk/login",
        tagline: "Delivery",
      },
      {
        id: "ubereats",
        name: "Uber Eats",
        url: "https://www.ubereats.com/login-redirect/",
        tagline: "Delivery",
      },
    ],
  },
  {
    title: "Shopping",
    sites: [
      {
        id: "amazon",
        name: "Amazon",
        url: "https://www.amazon.co.uk/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.co.uk%2F&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=gbflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0",
        tagline: "Buy anything",
      },
      {
        id: "ebay",
        name: "eBay",
        url: "https://signin.ebay.co.uk/",
        tagline: "Second-hand",
      },
    ],
  },
  {
    title: "Travel",
    sites: [
      {
        id: "trainline",
        name: "Trainline",
        url: "https://www.thetrainline.com/login",
        tagline: "Trains",
      },
      {
        id: "ryanair",
        name: "Ryanair",
        url: "https://www.ryanair.com/gb/en/account/login",
        tagline: "Flights",
      },
    ],
  },
  {
    title: "Social",
    sites: [
      {
        id: "linkedin",
        name: "LinkedIn",
        url: "https://www.linkedin.com/login",
        tagline: "Network",
      },
      {
        id: "x",
        name: "X",
        url: "https://x.com/i/flow/login",
        tagline: "Post · DM",
      },
    ],
  },
  {
    title: "Banking",
    sites: [
      {
        id: "monzo",
        name: "Monzo",
        url: "https://app.monzo.com/",
        tagline: "Web app",
      },
    ],
  },
];

export function SitesConsole() {
  const [busy, setBusy] = useState<string | null>(null);
  const [watching, setWatching] = useState<string | null>(null);
  const [connected, setConnected] = useState<Connected>({});
  const [flash, setFlash] = useState<string | null>(null);
  const pollRef = useRef<{ siteId: string; timer: ReturnType<typeof setInterval>; deadline: number } | null>(null);

  useEffect(() => {
    setConnected(loadConnected());
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current.timer);
    };
  }, []);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current.timer);
      pollRef.current = null;
    }
    setWatching(null);
  }

  function markConnected(site: Site, note?: string) {
    setConnected((prev) => {
      const next = { ...prev, [site.id]: new Date().toISOString() };
      saveConnected(next);
      return next;
    });
    stopPolling();
    setFlash(note ?? `${site.name} signed in. JARVIS stays logged in from now on.`);
  }

  function startPolling(site: Site) {
    if (pollRef.current) clearInterval(pollRef.current.timer);
    setWatching(site.id);
    const deadline = Date.now() + 3 * 60 * 1000; // 3 minutes

    const tick = async () => {
      if (Date.now() > deadline) {
        setFlash(`Stopped watching ${site.name}. If you did sign in, JARVIS still has the cookie — click Sign in again to re-check, or just try a task.`);
        stopPolling();
        return;
      }
      try {
        const res = await fetch("/api/sites/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ loginUrl: site.url }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as { ok: boolean; signedIn: boolean };
        if (body.ok && body.signedIn) {
          markConnected(site);
        }
      } catch {
        /* swallow, keep polling */
      }
    };

    const timer = setInterval(() => void tick(), 2000);
    pollRef.current = { siteId: site.id, timer, deadline };
    void tick();
  }

  async function open(site: Site) {
    setBusy(site.id);
    setFlash(null);
    try {
      const res = await fetch("/api/sites/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: site.url }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "open failed");
      setFlash(`Opened ${site.name} — sign in on the Chromium window. I'm watching for you to finish.`);
      startPolling(site);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function disconnect(site: Site) {
    setConnected((prev) => {
      const next = { ...prev };
      delete next[site.id];
      saveConnected(next);
      return next;
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13.5,
          color: "var(--ink-2)",
          lineHeight: 1.6,
          maxWidth: 680,
        }}
      >
        Pre-sign-in once, stay signed in forever. Each button pops the login
        page in JARVIS&apos;s background Chromium. Sign in, close the window —
        JARVIS stays logged in on every future task (booking rides, ordering
        food, buying things).
      </div>

      {flash && (
        <Card padding="12px 16px">
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.5,
            }}
          >
            {flash}
          </div>
        </Card>
      )}

      {CATEGORIES.map((cat) => (
        <div key={cat.title} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              letterSpacing: "1.6px",
              textTransform: "uppercase",
              color: "var(--ink-3)",
            }}
          >
            {cat.title}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 10,
            }}
          >
            {cat.sites.map((site) => {
              const isConnected = Boolean(connected[site.id]);
              const isWatching = watching === site.id;
              const isBusy = busy === site.id;
              const dotColor = isConnected ? "#22c55e" : isWatching ? "#f59e0b" : "var(--ink-4)";
              const subline = isConnected
                ? `Connected · ${formatAge(connected[site.id]!)}`
                : isWatching
                ? "Waiting for you to sign in…"
                : site.tagline;
              return (
                <Card key={site.id} padding="14px 16px">
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: dotColor,
                        flexShrink: 0,
                        animation: isWatching ? "jv-pulse 1.2s ease-in-out infinite" : "none",
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--sans)",
                          fontSize: 14.5,
                          fontWeight: 500,
                          color: "var(--ink)",
                        }}
                      >
                        {site.name}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 10.5,
                          color: "var(--ink-3)",
                          letterSpacing: "0.4px",
                          marginTop: 2,
                        }}
                      >
                        {subline}
                      </div>
                    </div>

                    {isConnected ? (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => void open(site)}
                          disabled={isBusy}
                          style={{
                            fontFamily: "var(--sans)",
                            fontSize: 12,
                            padding: "5px 10px",
                            borderRadius: 999,
                            background: "transparent",
                            color: "var(--ink-2)",
                            border: "1px solid var(--rule)",
                            cursor: isBusy ? "default" : "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isBusy ? "opening…" : "Re-sign in"}
                        </button>
                        <button
                          onClick={() => disconnect(site)}
                          style={{
                            fontFamily: "var(--sans)",
                            fontSize: 12,
                            padding: "5px 10px",
                            borderRadius: 999,
                            background: "transparent",
                            color: "var(--ink-3)",
                            border: "1px solid transparent",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Forget
                        </button>
                      </div>
                    ) : isWatching ? (
                      <button
                        onClick={() => stopPolling()}
                        style={{
                          fontFamily: "var(--sans)",
                          fontSize: 12,
                          padding: "5px 10px",
                          borderRadius: 999,
                          background: "transparent",
                          color: "var(--ink-3)",
                          border: "1px solid var(--rule)",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        onClick={() => void open(site)}
                        disabled={busy !== null}
                        style={{
                          fontFamily: "var(--sans)",
                          fontSize: 12.5,
                          padding: "6px 12px",
                          borderRadius: 999,
                          background: isBusy ? "var(--surface-2)" : "var(--ink)",
                          color: isBusy ? "var(--ink-3)" : "#000",
                          border: `1px solid ${isBusy ? "var(--rule)" : "var(--ink)"}`,
                          cursor: busy ? "default" : "pointer",
                          fontWeight: 500,
                          opacity: busy && !isBusy ? 0.5 : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {isBusy ? "opening…" : "Sign in"}
                      </button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
