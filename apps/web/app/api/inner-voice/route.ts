// GET /api/inner-voice — list inner-voice utterances + latest atlas summary.
//
//   ?voice=critic|dreamer|calculator|frightened|soldier|philosopher|victim|coach|comedian|scholar|all  (default all)
//   ?scan_id=<uuid>   — restrict to one scan (defaults to latest scan)
//   ?status=live|pinned|archived|all  (default live = not archived)
//   ?limit=N  (default 80, max 300)
//
// Returns:
//   { utterances: [...], latest_scan: {...} | null, stats: {voice_counts, total} }

import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID_VOICES = new Set([
  "critic", "dreamer", "calculator", "frightened", "soldier",
  "philosopher", "victim", "coach", "comedian", "scholar",
]);

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const voice = url.searchParams.get("voice");
  const scanIdParam = url.searchParams.get("scan_id");
  const status = url.searchParams.get("status") ?? "live";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "80", 10);
  const limit = Math.max(1, Math.min(300, isNaN(limitRaw) ? 80 : limitRaw));

  // Latest scan
  const { data: latestScan } = await supabase
    .from("inner_voice_atlas_scans")
    .select("id, window_days, total_utterances, dominant_voice, second_voice, voice_counts, atlas_narrative, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let q = supabase
    .from("inner_voices")
    .select("id, scan_id, voice, excerpt, gloss, intensity, spoken_at, source_conversation_id, source_message_id, pinned, archived_at, user_note, created_at")
    .eq("user_id", user.id);

  // Default to the latest scan if no scan_id supplied — keeps the page tied
  // to one coherent atlas read.
  const scanId = scanIdParam || (latestScan?.id ?? null);
  if (scanId) q = q.eq("scan_id", scanId);

  if (voice && voice !== "all" && VALID_VOICES.has(voice)) q = q.eq("voice", voice);

  if (status === "live") q = q.is("archived_at", null);
  else if (status === "pinned") q = q.eq("pinned", true).is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  // status === "all" — no filter

  q = q.order("intensity", { ascending: false }).order("spoken_at", { ascending: false }).limit(limit);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Voice counts for THIS scan (so UI can show distribution)
  const counts: Record<string, number> = {};
  if (scanId) {
    const { data: countsRows } = await supabase
      .from("inner_voices")
      .select("voice")
      .eq("user_id", user.id)
      .eq("scan_id", scanId)
      .is("archived_at", null);
    for (const r of (countsRows ?? []) as Array<{ voice: string }>) {
      counts[r.voice] = (counts[r.voice] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    utterances: data ?? [],
    latest_scan: latestScan ?? null,
    scan_id: scanId,
    stats: {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      voice_counts: counts,
    },
  });
}
