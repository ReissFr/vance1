// Returns the real connection state of every provider the /integrations page
// surfaces. No lies — only providers with actual backend wiring show up as
// connectable, and "connected" only if there's an active integrations row.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProviderKey =
  | "gmail"
  | "gcal"
  | "stripe"
  | "paypal"
  | "square"
  | "shopify"
  | "xero"
  | "quickbooks"
  | "freeagent"
  | "smartthings"
  | "truelayer"
  | "monzo"
  | "plaid"
  | "coinbase"
  | "kraken"
  | "notion"
  | "github"
  | "slack"
  | "calcom"
  | "linear"
  | "todoist"
  | "resend"
  | "google_drive";

type Row = {
  key: ProviderKey;
  kind: string;
  provider: string;
  connected: boolean;
  email: string | null;
  updated_at: string | null;
  expires_at: string | null;
};

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data: rows } = await supabase
    .from("integrations")
    .select("kind, provider, active, updated_at, expires_at, metadata")
    .eq("user_id", user.id)
    .eq("active", true);

  type IntegrationRow = {
    kind: string;
    provider: string;
    active: boolean;
    updated_at: string | null;
    expires_at: string | null;
    metadata: Record<string, unknown> | null;
  };
  const by = new Map<string, IntegrationRow>();
  for (const r of (rows ?? []) as IntegrationRow[]) {
    by.set(`${r.kind}:${r.provider}`, r);
  }

  const pick = (
    key: ProviderKey,
    kind: string,
    provider: string,
  ): Row => {
    const r = by.get(`${kind}:${provider}`);
    return {
      key,
      kind,
      provider,
      connected: Boolean(r),
      email: (r?.metadata as { email?: string } | null)?.email ?? null,
      updated_at: r?.updated_at ?? null,
      expires_at: r?.expires_at ?? null,
    };
  };

  const gmailRow = by.get("email:gmail");
  const integrations: Row[] = [
    {
      ...pick("gmail", "email", "gmail"),
      email:
        (gmailRow?.metadata as { email?: string } | null)?.email ??
        user.email ??
        null,
    },
    // Google Calendar rides on the same Google OAuth session as Gmail — if
    // Gmail is connected with the calendar.events scope, calendar works too.
    {
      key: "gcal",
      kind: "calendar",
      provider: "google",
      connected: Boolean(gmailRow),
      email:
        (gmailRow?.metadata as { email?: string } | null)?.email ??
        user.email ??
        null,
      updated_at: gmailRow?.updated_at ?? null,
      expires_at: gmailRow?.expires_at ?? null,
    },
    pick("stripe", "payment", "stripe"),
    pick("paypal", "payment", "paypal"),
    pick("square", "payment", "square"),
    pick("shopify", "commerce", "shopify"),
    pick("xero", "accounting", "xero"),
    pick("quickbooks", "accounting", "quickbooks"),
    pick("freeagent", "accounting", "freeagent"),
    pick("smartthings", "home", "smartthings"),
    pick("truelayer", "banking", "truelayer"),
    pick("monzo", "banking", "monzo"),
    pick("coinbase", "crypto", "coinbase"),
    pick("kraken", "crypto", "kraken"),
    pick("notion", "productivity", "notion"),
    pick("github", "dev", "github"),
    pick("slack", "messaging", "slack"),
    pick("calcom", "calendar", "calcom"),
    pick("linear", "tasks", "linear"),
    pick("todoist", "tasks", "todoist"),
    pick("resend", "transactional", "resend"),
    pick("google_drive", "files", "google_drive"),
    pick("plaid", "banking", "plaid"),
  ];

  return NextResponse.json({ ok: true, integrations });
}
