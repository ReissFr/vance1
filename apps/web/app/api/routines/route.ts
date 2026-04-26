// Routines CRUD. GET supports ?q=... fuzzy match across name/description.
// POST upserts by (user_id, name) so re-saving with the same name updates the
// step list — keeps the routine library tidy without dupes.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
}

function sanitizeSteps(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().slice(0, 400))
    .filter(Boolean)
    .slice(0, 40);
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q");
  const tag = req.nextUrl.searchParams.get("tag");

  let query = supabase
    .from("routines")
    .select("id, name, description, steps, tags, use_count, last_used_at, created_at, updated_at")
    .eq("user_id", user.id);

  if (q && q.trim()) {
    const needle = q.trim().slice(0, 80);
    query = query.or(`name.ilike.%${needle}%,description.ilike.%${needle}%`);
  }
  if (tag) {
    query = query.contains("tags", [tag]);
  }

  query = query
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const steps = sanitizeSteps(body.steps);
  if (steps.length === 0) {
    return NextResponse.json({ error: "at least one step required" }, { status: 400 });
  }

  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 600) || null : null;
  const tags = sanitizeTags(body.tags);

  const { data, error } = await supabase
    .from("routines")
    .upsert(
      {
        user_id: user.id,
        name,
        description,
        steps,
        tags,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,name" },
    )
    .select("id, name, description, steps, tags, use_count, last_used_at, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ routine: data });
}
