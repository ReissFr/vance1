// List the user's armed watchers — automations with any trigger kind, ordered
// by most-recently-fired first. The /watchers page uses this to render the
// "what's armed" list alongside the preset templates.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type WatcherRow = {
  id: string;
  title: string;
  description: string | null;
  trigger_kind: string;
  trigger_spec: Record<string, unknown>;
  action_chain: unknown;
  ask_first: boolean;
  enabled: boolean;
  last_fired_at: string | null;
  last_checked_at: string | null;
  fire_count: number;
  state: Record<string, unknown> | null;
  created_at: string;
};

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("automations")
    .select(
      "id, title, description, trigger_kind, trigger_spec, action_chain, ask_first, enabled, last_fired_at, last_checked_at, fire_count, state, created_at",
    )
    .eq("user_id", user.id)
    .order("enabled", { ascending: false })
    .order("last_fired_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, watchers: (data ?? []) as WatcherRow[] });
}
