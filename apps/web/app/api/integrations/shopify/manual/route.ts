// Store a user's Shopify custom-app admin API token as their commerce
// integration. Validates by calling /admin/api/<v>/shop.json.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { upsertIntegration } from "@/lib/integrations-upsert";

export const runtime = "nodejs";

const API_VERSION = "2025-01";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { shop_domain?: string; admin_access_token?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const token = body.admin_access_token?.trim();
  let shop = body.shop_domain?.trim().toLowerCase() ?? "";
  if (!token || !shop) {
    return NextResponse.json(
      { ok: false, error: "shop_domain and admin_access_token required" },
      { status: 400 },
    );
  }
  shop = shop.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!shop.includes(".")) shop = `${shop}.myshopify.com`;

  const ping = await fetch(`https://${shop}/admin/api/${API_VERSION}/shop.json`, {
    headers: {
      "X-Shopify-Access-Token": token,
      Accept: "application/json",
    },
  });
  if (!ping.ok) {
    return NextResponse.json(
      { ok: false, error: `shopify rejected the token (${ping.status})` },
      { status: 400 },
    );
  }
  const json = (await ping.json().catch(() => null)) as
    | { shop?: { name?: string; email?: string } }
    | null;

  const admin = supabaseAdmin();
  try {
    await upsertIntegration(admin, {
      userId: user.id,
      kind: "commerce",
      provider: "shopify",
      credentials: { shop_domain: shop, admin_access_token: token },
      metadata: {
        shop_name: json?.shop?.name ?? null,
        shop_email: json?.shop?.email ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
