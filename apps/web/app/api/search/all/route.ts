// Cross-entity search across the user's structured data — commitments,
// receipts, subscriptions, memories, tasks. Sibling to /api/recall/search
// which handles the unstructured recall archive (emails/chat/meetings).
// Uses ilike on a minimal set of text columns per table; returns unified rows
// with `entity`, `href`, `title`, `subtitle`, `ts` so the UI can render them
// in one flat list.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Entity = "commitment" | "receipt" | "subscription" | "memory" | "task";

type Hit = {
  entity: Entity;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  ts: string | null;
};

function escapeLike(s: string): string {
  return s.replace(/([%_,])/g, "\\$1");
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ hits: [], query: "" });

  const pattern = `%${escapeLike(q)}%`;
  const perEntity = 8;

  const [commitments, receipts, subscriptions, memories, tasks] = await Promise.all([
    supabase
      .from("commitments")
      .select("id, commitment_text, other_party, direction, deadline, status, updated_at")
      .eq("user_id", user.id)
      .or(`commitment_text.ilike.${pattern},other_party.ilike.${pattern}`)
      .order("updated_at", { ascending: false })
      .limit(perEntity),
    supabase
      .from("receipts")
      .select("id, merchant, description, amount, currency, purchased_at, updated_at")
      .eq("user_id", user.id)
      .or(`merchant.ilike.${pattern},description.ilike.${pattern}`)
      .order("purchased_at", { ascending: false, nullsFirst: false })
      .limit(perEntity),
    supabase
      .from("subscriptions")
      .select("id, service_name, amount, currency, cadence, status, next_renewal_date, updated_at")
      .eq("user_id", user.id)
      .ilike("service_name", pattern)
      .order("next_renewal_date", { ascending: true, nullsFirst: false })
      .limit(perEntity),
    supabase
      .from("memories")
      .select("id, kind, content, created_at")
      .eq("user_id", user.id)
      .ilike("content", pattern)
      .order("created_at", { ascending: false })
      .limit(perEntity),
    supabase
      .from("tasks")
      .select("id, kind, status, args, created_at, completed_at")
      .eq("user_id", user.id)
      .ilike("prompt", pattern)
      .order("created_at", { ascending: false })
      .limit(perEntity),
  ]);

  const hits: Hit[] = [];

  for (const c of (commitments.data ?? []) as Array<{
    id: string;
    commitment_text: string;
    other_party: string | null;
    direction: string;
    deadline: string | null;
    status: string;
    updated_at: string;
  }>) {
    hits.push({
      entity: "commitment",
      id: c.id,
      title: c.commitment_text,
      subtitle: `${c.direction === "outbound" ? "You owe" : "They owe"} ${c.other_party ?? "?"} · ${c.status}${c.deadline ? ` · ${c.deadline.slice(0, 10)}` : ""}`,
      href: `/commitments?id=${c.id}`,
      ts: c.updated_at,
    });
  }

  for (const r of (receipts.data ?? []) as Array<{
    id: string;
    merchant: string;
    description: string | null;
    amount: number | null;
    currency: string | null;
    purchased_at: string | null;
    updated_at: string;
  }>) {
    const amt =
      r.amount != null ? `${r.currency ?? "GBP"} ${Number(r.amount).toFixed(2)}` : "";
    hits.push({
      entity: "receipt",
      id: r.id,
      title: r.merchant,
      subtitle: [amt, r.description].filter(Boolean).join(" · ") || null,
      href: `/receipts?id=${r.id}`,
      ts: r.purchased_at ?? r.updated_at,
    });
  }

  for (const s of (subscriptions.data ?? []) as Array<{
    id: string;
    service_name: string;
    amount: number | null;
    currency: string | null;
    cadence: string;
    status: string;
    next_renewal_date: string | null;
    updated_at: string;
  }>) {
    const amt = s.amount != null ? `${s.currency ?? "GBP"} ${Number(s.amount).toFixed(2)}` : "";
    hits.push({
      entity: "subscription",
      id: s.id,
      title: s.service_name,
      subtitle: [amt, s.cadence, s.status, s.next_renewal_date ? `renews ${s.next_renewal_date}` : null]
        .filter(Boolean)
        .join(" · ") || null,
      href: `/subscriptions?id=${s.id}`,
      ts: s.next_renewal_date ?? s.updated_at,
    });
  }

  for (const m of (memories.data ?? []) as Array<{
    id: string;
    kind: string;
    content: string;
    created_at: string;
  }>) {
    hits.push({
      entity: "memory",
      id: m.id,
      title: m.content,
      subtitle: m.kind,
      href: `/memory?id=${m.id}`,
      ts: m.created_at,
    });
  }

  for (const t of (tasks.data ?? []) as Array<{
    id: string;
    kind: string;
    status: string;
    args: { title?: string } | null;
    created_at: string;
    completed_at: string | null;
  }>) {
    const title = (t.args?.title as string | undefined) ?? t.kind;
    hits.push({
      entity: "task",
      id: t.id,
      title,
      subtitle: `${t.kind} · ${t.status}`,
      href: `/history?task=${t.id}`,
      ts: t.completed_at ?? t.created_at,
    });
  }

  hits.sort((a, b) => {
    const ta = a.ts ? Date.parse(a.ts) : 0;
    const tb = b.ts ? Date.parse(b.ts) : 0;
    return tb - ta;
  });

  return NextResponse.json({ hits, query: q });
}
