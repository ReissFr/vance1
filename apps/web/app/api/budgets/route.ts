import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { computeBudgetStatuses } from "@/lib/budget-check";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data: budgets, error } = await admin
    .from("budgets")
    .select("id, category, amount, currency, include_subs, active, notes, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const statuses = await computeBudgetStatuses(admin, user.id);
  const byId = new Map(statuses.map((s) => [s.budget_id, s]));
  const merged = (budgets ?? []).map((b) => ({
    ...b,
    status: byId.get(b.id as string) ?? null,
  }));

  return NextResponse.json({ budgets: merged });
}

interface CreateBody {
  category?: string;
  amount?: number;
  currency?: string;
  include_subs?: boolean;
  notes?: string;
}

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!body.category?.trim()) return NextResponse.json({ error: "category required" }, { status: 400 });
  if (!body.amount || body.amount <= 0) return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("budgets")
    .upsert(
      {
        user_id: user.id,
        category: body.category.trim(),
        amount: body.amount,
        currency: body.currency ?? "GBP",
        include_subs: body.include_subs ?? true,
        notes: body.notes ?? null,
        active: true,
        period: "month",
      },
      { onConflict: "user_id,category,period" },
    )
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data?.id });
}
