// Policies CRUD. GET supports ?category=&active=true|false|all (default
// active=true). POST upserts on (user_id, name) so re-saving with the same
// name updates the rule / priority in place.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_CATEGORIES = new Set([
  "scheduling",
  "communication",
  "finance",
  "health",
  "relationships",
  "work",
  "general",
]);

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
}

function clampPriority(input: unknown): number {
  if (typeof input !== "number") return 3;
  const v = Math.round(input);
  if (v < 1) return 1;
  if (v > 5) return 5;
  return v;
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const category = req.nextUrl.searchParams.get("category");
  const active = (req.nextUrl.searchParams.get("active") ?? "true").toLowerCase();

  let q = supabase
    .from("policies")
    .select("id, name, rule, category, priority, active, examples, tags, created_at, updated_at")
    .eq("user_id", user.id);

  if (active !== "all") {
    q = q.eq("active", active === "true");
  }
  if (category && VALID_CATEGORIES.has(category)) {
    q = q.eq("category", category);
  }

  q = q.order("priority", { ascending: false }).order("updated_at", { ascending: false }).limit(200);

  const { data, error } = await q;
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

  const rule = typeof body.rule === "string" ? body.rule.trim().slice(0, 2000) : "";
  if (!rule) return NextResponse.json({ error: "rule required" }, { status: 400 });

  const category =
    typeof body.category === "string" && VALID_CATEGORIES.has(body.category)
      ? body.category
      : "general";
  const priority = clampPriority(body.priority);
  const examples =
    typeof body.examples === "string" ? body.examples.trim().slice(0, 2000) || null : null;
  const tags = sanitizeTags(body.tags);

  const { data, error } = await supabase
    .from("policies")
    .upsert(
      {
        user_id: user.id,
        name,
        rule,
        category,
        priority,
        examples,
        tags,
        active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,name" },
    )
    .select("id, name, rule, category, priority, active, examples, tags, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ policy: data });
}
