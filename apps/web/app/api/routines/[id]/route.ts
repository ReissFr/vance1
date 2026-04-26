// Update or delete a routine. PATCH { used: true } stamps last_used_at +
// increments use_count atomically (so brain can mark "I just ran this").

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

  if (body.used === true) {
    const { data: cur, error: loadErr } = await supabase
      .from("routines")
      .select("use_count")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
    const next = (cur?.use_count ?? 0) + 1;
    const { error } = await supabase
      .from("routines")
      .update({
        use_count: next,
        last_used_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, use_count: next });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") {
    const n = body.name.trim().slice(0, 80);
    if (!n) return NextResponse.json({ error: "name empty" }, { status: 400 });
    patch.name = n;
  }
  if (typeof body.description === "string") {
    patch.description = body.description.trim().slice(0, 600) || null;
  }
  if (Array.isArray(body.steps)) {
    const steps = sanitizeSteps(body.steps);
    if (steps.length === 0) {
      return NextResponse.json({ error: "at least one step required" }, { status: 400 });
    }
    patch.steps = steps;
  }
  if (Array.isArray(body.tags)) {
    patch.tags = sanitizeTags(body.tags);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("routines")
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
    .from("routines")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
