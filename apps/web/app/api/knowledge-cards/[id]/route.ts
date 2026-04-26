// Edit or delete a single knowledge card.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_KINDS = new Set([
  "stat",
  "quote",
  "principle",
  "playbook",
  "anecdote",
  "definition",
  "other",
]);

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

  const patch: Record<string, unknown> = {};

  if (typeof body.claim === "string") {
    const t = body.claim.trim().slice(0, 2000);
    if (!t) return NextResponse.json({ error: "claim empty" }, { status: 400 });
    patch.claim = t;
  }
  if (typeof body.kind === "string" && VALID_KINDS.has(body.kind)) patch.kind = body.kind;

  const trimNullable = (k: string, max: number) => {
    if (typeof body[k] !== "string") return;
    const t = (body[k] as string).trim().slice(0, max);
    patch[k] = t || null;
  };
  trimNullable("source", 200);
  trimNullable("url", 600);

  if (Array.isArray(body.tags)) patch.tags = sanitizeTags(body.tags);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("knowledge_cards")
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
    .from("knowledge_cards")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
