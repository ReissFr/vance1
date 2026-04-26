// Knowledge cards CRUD. Atomic facts/quotes/principles. GET supports
// ?q=&kind=&tag=. POST validates kind enum and trims long claims.

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

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q");
  const kind = req.nextUrl.searchParams.get("kind");
  const tag = req.nextUrl.searchParams.get("tag");

  let query = supabase
    .from("knowledge_cards")
    .select("id, claim, source, url, kind, tags, created_at, updated_at")
    .eq("user_id", user.id);

  if (kind && kind !== "all" && VALID_KINDS.has(kind)) query = query.eq("kind", kind);
  if (tag) query = query.contains("tags", [tag]);
  if (q && q.trim()) {
    const needle = q.trim().slice(0, 80);
    query = query.or(`claim.ilike.%${needle}%,source.ilike.%${needle}%`);
  }

  query = query.order("created_at", { ascending: false }).limit(200);

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

  const claim = typeof body.claim === "string" ? body.claim.trim().slice(0, 2000) : "";
  if (!claim) return NextResponse.json({ error: "claim required" }, { status: 400 });

  const kind =
    typeof body.kind === "string" && VALID_KINDS.has(body.kind) ? body.kind : "other";

  const trimStr = (k: string, max: number): string | null => {
    const v = body[k];
    if (typeof v !== "string") return null;
    const t = v.trim().slice(0, max);
    return t || null;
  };

  const { data, error } = await supabase
    .from("knowledge_cards")
    .insert({
      user_id: user.id,
      claim,
      source: trimStr("source", 200),
      url: trimStr("url", 600),
      kind,
      tags: sanitizeTags(body.tags),
    })
    .select("id, claim, source, url, kind, tags, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ card: data });
}
