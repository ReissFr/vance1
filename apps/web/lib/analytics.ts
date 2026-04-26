import { supabaseAdmin } from "./supabase/server";

type Source = "web" | "mac" | "iphone" | "whatsapp" | "server";

type TrackOptions = {
  userId?: string | null;
  anonymousId?: string | null;
  path?: string | null;
  properties?: Record<string, unknown>;
  sessionId?: string | null;
  source?: Source;
};

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com";

async function forwardToPostHog(event: string, opts: TrackOptions): Promise<boolean> {
  const key = process.env.POSTHOG_KEY;
  if (!key) return false;

  const distinctId = opts.userId ?? opts.anonymousId ?? "anonymous";
  try {
    const res = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        properties: {
          ...opts.properties,
          $current_url: opts.path,
          $session_id: opts.sessionId,
          source: opts.source ?? "server",
        },
        timestamp: new Date().toISOString(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function trackEvent(event: string, opts: TrackOptions = {}): Promise<void> {
  const posthogForwarded = await forwardToPostHog(event, opts);
  try {
    const admin = supabaseAdmin();
    await admin.from("analytics_events").insert({
      user_id: opts.userId ?? null,
      anonymous_id: opts.anonymousId ?? null,
      event,
      path: opts.path ?? null,
      properties: opts.properties ?? null,
      session_id: opts.sessionId ?? null,
      source: opts.source ?? "server",
      posthog_forwarded: posthogForwarded,
    });
  } catch {
    // Swallow — analytics must never throw.
  }
}
