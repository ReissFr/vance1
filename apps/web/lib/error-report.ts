import { supabaseAdmin } from "./supabase/server";

type Severity = "error" | "warn" | "info";

type ReportOptions = {
  route?: string;
  method?: string;
  userId?: string | null;
  context?: Record<string, unknown>;
  severity?: Severity;
};

function parseSentryDsn(dsn: string): { host: string; projectId: string; publicKey: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!projectId || !u.username) return null;
    return { host: u.host, projectId, publicKey: u.username };
  } catch {
    return null;
  }
}

async function forwardToSentry(err: Error, opts: ReportOptions): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return false;

  const eventId = crypto.randomUUID().replace(/-/g, "");
  const now = new Date().toISOString();
  const envelope =
    JSON.stringify({
      event_id: eventId,
      sent_at: now,
      dsn,
    }) +
    "\n" +
    JSON.stringify({ type: "event" }) +
    "\n" +
    JSON.stringify({
      event_id: eventId,
      timestamp: now,
      platform: "node",
      level: opts.severity ?? "error",
      environment: process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? "production",
      release: process.env.SENTRY_RELEASE,
      server_name: "jarvis-web",
      transaction: opts.route,
      user: opts.userId ? { id: opts.userId } : undefined,
      tags: { route: opts.route, method: opts.method },
      extra: opts.context,
      exception: {
        values: [
          {
            type: err.name || "Error",
            value: err.message || String(err),
            stacktrace: err.stack
              ? {
                  frames: err.stack
                    .split("\n")
                    .slice(1)
                    .reverse()
                    .map((line) => ({ filename: line.trim() })),
                }
              : undefined,
          },
        ],
      },
    });

  try {
    await fetch(
      `https://${parsed.host}/api/${parsed.projectId}/envelope/?sentry_key=${parsed.publicKey}&sentry_version=7`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-sentry-envelope" },
        body: envelope,
      },
    );
    return true;
  } catch {
    return false;
  }
}

export async function reportError(err: unknown, opts: ReportOptions = {}): Promise<void> {
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
  const severity = opts.severity ?? "error";

  // Always log to console so local + Netlify logs still see it.
  // eslint-disable-next-line no-console
  console.error(`[${severity}] ${opts.route ?? ""} ${opts.method ?? ""}:`, e.message, opts.context ?? "");

  const sentryForwarded = await forwardToSentry(e, opts);

  try {
    const admin = supabaseAdmin();
    await admin.from("error_events").insert({
      user_id: opts.userId ?? null,
      route: opts.route ?? null,
      method: opts.method ?? null,
      message: e.message || String(e),
      stack: e.stack ?? null,
      context: opts.context ?? null,
      severity,
      sentry_forwarded: sentryForwarded,
    });
  } catch {
    // Swallow — reporting must never throw.
  }
}

export function withErrorReport<
  H extends (req: Request, ctx?: unknown) => Promise<Response>,
>(handler: H, routeLabel: string): H {
  return (async (req: Request, ctx?: unknown) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      await reportError(err, { route: routeLabel, method: req.method });
      throw err;
    }
  }) as H;
}
