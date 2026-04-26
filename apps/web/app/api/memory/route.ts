// List and create long-term memories. Backs the /memory viewer UI.
// Create uses the same Voyage embed path as save_memory tool so recall
// works the same whether the user added from chat or from the UI.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { makeVoyageEmbed, saveMemory } from "@jarvis/agent";

export const runtime = "nodejs";

const KINDS = ["fact", "preference", "person", "event", "task"] as const;
type Kind = (typeof KINDS)[number];

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const q = searchParams.get("q")?.trim() ?? "";
  const pinnedOnly = searchParams.get("pinned") === "1";
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 500);

  let query = supabaseAdmin()
    .from("memories")
    .select("id, kind, content, pinned, created_at")
    .eq("user_id", user.id)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (kind && (KINDS as readonly string[]).includes(kind)) {
    query = query.eq("kind", kind);
  }
  if (pinnedOnly) {
    query = query.eq("pinned", true);
  }
  if (q) {
    // Escape PostgREST pattern wildcards — users type plain text, they're not
    // expecting SQL LIKE semantics.
    const pattern = `%${q.replace(/([%_,])/g, "\\$1")}%`;
    query = query.ilike("content", pattern);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ memories: data ?? [] });
}

interface PostBody {
  kind: Kind;
  content: string;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as PostBody;
  if (!body.content?.trim()) {
    return NextResponse.json({ error: "empty content" }, { status: 400 });
  }
  if (!KINDS.includes(body.kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const embed = makeVoyageEmbed(process.env.VOYAGE_API_KEY!);
  const m = await saveMemory(admin, embed, {
    userId: user.id,
    kind: body.kind,
    content: body.content.trim(),
  });
  return NextResponse.json({ ok: true, memory: { id: m.id, kind: m.kind, content: m.content, created_at: m.created_at } });
}
