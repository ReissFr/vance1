// GET /api/recall/search?q=…&sources=email,chat&since=2026-01-01
// Semantic search across the user's Total Recall archive.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { searchRecall, type RecallSource } from "@/lib/recall";

export const runtime = "nodejs";

const VALID_SOURCES: RecallSource[] = ["email", "chat", "calendar", "whatsapp", "screen", "meeting", "note"];

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ results: [] });

  const rawSources = url.searchParams.get("sources");
  const sources = rawSources
    ? rawSources
        .split(",")
        .map((s) => s.trim() as RecallSource)
        .filter((s) => VALID_SOURCES.includes(s))
    : undefined;
  const since = url.searchParams.get("since") ?? undefined;
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "12", 10)));

  const admin = supabaseAdmin();
  try {
    const results = await searchRecall(admin, user.id, q, {
      matchCount: limit,
      ...(sources && sources.length ? { sources } : {}),
      ...(since ? { sinceISO: since } : {}),
    });
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
