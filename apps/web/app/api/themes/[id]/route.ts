// PATCH supports per-field updates plus { close: true, outcome? } to
// transition a theme into status='closed' with closed_at = now() and an
// optional outcome note. Reopen via { reopen: true }.

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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.close === true) {
    const outcome =
      typeof body.outcome === "string" ? body.outcome.trim().slice(0, 2000) || null : null;
    const { error } = await supabase
      .from("themes")
      .update({
        status: "closed",
        closed_at: new Date().toISOString(),
        outcome,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, closed: true });
  }

  if (body.reopen === true) {
    const { error } = await supabase
      .from("themes")
      .update({
        status: "active",
        closed_at: null,
        outcome: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, reopened: true });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 120);
    if (!t) return NextResponse.json({ error: "title empty" }, { status: 400 });
    patch.title = t;
  }
  if (typeof body.kind === "string" && VALID_KINDS.has(body.kind)) patch.kind = body.kind;
  if (typeof body.status === "string" && VALID_STATUSES.has(body.status)) {
    patch.status = body.status;
    if (body.status !== "closed") {
      patch.closed_at = null;
      patch.outcome = null;
    }
  }
  if (typeof body.description === "string") {
    patch.description = body.description.trim().slice(0, 2000) || null;
  }
  if (typeof body.current_state === "string") {
    patch.current_state = body.current_state.trim().slice(0, 4000) || null;
  }
  if (typeof body.outcome === "string") {
    patch.outcome = body.outcome.trim().slice(0, 2000) || null;
  }
  if (Array.isArray(body.tags)) {
    patch.tags = sanitizeTags(body.tags);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("themes")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("themes")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
