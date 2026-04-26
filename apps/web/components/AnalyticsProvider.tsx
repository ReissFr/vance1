"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

function getOrCreateAnonymousId(): string {
  if (typeof window === "undefined") return "server";
  const key = "jv_anon_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `anon_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "server";
  const key = "jv_session_id";
  const tsKey = "jv_session_ts";
  const THIRTY_MIN = 30 * 60 * 1000;

  const existingId = sessionStorage.getItem(key);
  const existingTs = Number(sessionStorage.getItem(tsKey) ?? 0);
  const now = Date.now();

  if (existingId && now - existingTs < THIRTY_MIN) {
    sessionStorage.setItem(tsKey, String(now));
    return existingId;
  }
  const fresh = `sess_${Math.random().toString(36).slice(2, 10)}_${now.toString(36)}`;
  sessionStorage.setItem(key, fresh);
  sessionStorage.setItem(tsKey, String(now));
  return fresh;
}

async function track(
  event: string,
  props: { path?: string; properties?: Record<string, unknown> } = {},
) {
  try {
    await fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        path: props.path,
        properties: props.properties,
        sessionId: getOrCreateSessionId(),
        anonymousId: getOrCreateAnonymousId(),
      }),
      keepalive: true,
    });
  } catch {
    // ignore — analytics must never break UX
  }
}

export function AnalyticsProvider() {
  const pathname = usePathname();
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === lastPath.current) return;
    lastPath.current = pathname;
    track("$pageview", { path: pathname });
  }, [pathname]);

  return null;
}

declare global {
  interface Window {
    jvTrack?: typeof track;
  }
}

if (typeof window !== "undefined") {
  window.jvTrack = track;
}
