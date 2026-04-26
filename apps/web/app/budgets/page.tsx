import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { BudgetsConsole } from "@/components/BudgetsConsole";

export default async function BudgetsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Budgets" meta="MONTHLY CATEGORIES · 80% WARN · 100% BREACH" />
      <BudgetsConsole />
    </AppShell>
  );
}
