// Update or delete a single person. PATCH { archived: true|false } sets/clears
// archived_at without touching other fields.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_RELATIONS = new Set([
  "friend",
  "family",
  "team",
  "customer",
  "prospect",
  "investor",
  "founder",
  "mentor",
  "vendor",
  "press",
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

  if (body.archived === true) patch.archived_at = new Date().toISOString();
  else if (body.archived === false) patch.archived_at = null;

  if (typeof body.name === "string") {
    const t = body.name.trim().slice(0, 120);
    if (!t) return NextResponse.json({ error: "name empty" }, { status: 400 });
    patch.name = t;
  }
  if (typeof body.relation === "string" && VALID_RELATIONS.has(body.relation)) {
    patch.relation = body.relation;
  }
  if (body.importance !== undefined) {
    const n = Number(body.importance);
    if (!Number.isFinite(n) || n < 1 || n > 3) {
      return NextResponse.json({ error: "importance 1-3" }, { status: 400 });
    }
    patch.importance = Math.round(n);
  }

  const trimNullable = (k: string, max: number) => {
    if (typeof body[k] !== "string") return;
    const t = (body[k] as string).trim().slice(0, max);
    patch[k] = t || null;
  };
  trimNullable("email", 200);
  trimNullable("phone", 50);
  trimNullable("company", 200);
  trimNullable("role", 200);
  trimNullable("notes", 4000);

  if (Array.isArray(body.tags)) patch.tags = sanitizeTags(body.tags);

  if (body.reconnect_every_days !== undefined) {
    if (body.reconnect_every_days === null) {
      patch.reconnect_every_days = null;
    } else {
      const n = Number(body.reconnect_every_days);
      if (Number.isFinite(n) && n >= 1 && n <= 365) {
        patch.reconnect_every_days = Math.round(n);
      } else if (n === 0) {
        patch.reconnect_every_days = null;
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from("people")
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
    .from("people")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
