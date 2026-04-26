import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? 80), 200);

  const admin = supabaseAdmin();
  const { data: convs, error } = await admin
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (convs ?? []).map((c) => c.id as string);
  const previews: Record<
    string,
    { lastUser: string | null; messageCount: number; totalCostUsd: number; taskCount: number }
  > = Object.fromEntries(
    ids.map((id) => [id, { lastUser: null, messageCount: 0, totalCostUsd: 0, taskCount: 0 }]),
  );

  if (ids.length > 0) {
    const [{ data: lastUser }, { data: allMessages }, { data: taskCosts }] = await Promise.all([
      admin
        .from("messages")
        .select("conversation_id, content, created_at")
        .in("conversation_id", ids)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(ids.length * 5),
      admin
        .from("messages")
        .select("conversation_id")
        .in("conversation_id", ids),
      admin
        .from("tasks")
        .select("conversation_id, cost_usd")
        .in("conversation_id", ids)
        .not("conversation_id", "is", null),
    ]);

    for (const row of (allMessages ?? []) as Array<{ conversation_id: string }>) {
      const p = previews[row.conversation_id];
      if (p) p.messageCount += 1;
    }
    for (const row of (taskCosts ?? []) as Array<{
      conversation_id: string;
      cost_usd: number | null;
    }>) {
      const p = previews[row.conversation_id];
      if (!p) continue;
      p.taskCount += 1;
      if (typeof row.cost_usd === "number") p.totalCostUsd += row.cost_usd;
    }
    const seen = new Set<string>();
    for (const row of (lastUser ?? []) as Array<{
      conversation_id: string;
      content: string;
    }>) {
      if (seen.has(row.conversation_id)) continue;
      seen.add(row.conversation_id);
      const p = previews[row.conversation_id];
      if (p) p.lastUser = row.content;
    }
  }

  const rows = (convs ?? []).map((c) => {
    const p = previews[c.id as string];
    return {
      id: c.id,
      title: c.title,
      created_at: c.created_at,
      updated_at: c.updated_at,
      last_user_message: p?.lastUser ?? null,
      message_count: p?.messageCount ?? 0,
      total_cost_usd: p && p.totalCostUsd > 0 ? p.totalCostUsd : null,
      task_count: p?.taskCount ?? 0,
    };
  });

  return NextResponse.json({ conversations: rows });
}

export async function DELETE(req: Request) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
