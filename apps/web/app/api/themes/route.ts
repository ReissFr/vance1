// Themes CRUD. GET supports ?status=active|paused|closed|all (default active).
// POST upserts on (user_id, title) so re-saving with the same title updates
// the description / current_state in place.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "work",
  "personal",
  "health",
  "relationships",
  "learning",
  "creative",
  "other",
]);
const VALID_STATUSES = new Set(["active", "paused", "closed"]);

function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return (input as unknown[])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 12);
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const status = (req.nextUrl.searchParams.get("status") ?? "active").toLowerCase();
  const kind = req.nextUrl.searchParams.get("kind");

  let q = supabase
    .from("themes")
    .select("id, title, kind, status, description, current_state, outcome, closed_at, tags, created_at, updated_at")
    .eq("user_id", user.id);

  if (status !== "all" && VALID_STATUSES.has(status)) {
    q = q.eq("status", status);
  }
  if (kind && VALID_KINDS.has(kind)) {
    q = q.eq("kind", kind);
  }

  q = q.order("updated_at", { ascending: false }).limit(200);

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

  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const kind = typeof body.kind === "string" && VALID_KINDS.has(body.kind) ? body.kind : "work";
  const description =
    typeof body.description === "string" ? body.description.trim().slice(0, 2000) || null : null;
  const currentState =
    typeof body.current_state === "string" ? body.current_state.trim().slice(0, 4000) || null : null;
  const tags = sanitizeTags(body.tags);

  const { data, error } = await supabase
    .from("themes")
    .upsert(
      {
        user_id: user.id,
        title,
        kind,
        description,
        current_state: currentState,
        tags,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,title" },
    )
    .select("id, title, kind, status, description, current_state, outcome, closed_at, tags, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ theme: data });
}
