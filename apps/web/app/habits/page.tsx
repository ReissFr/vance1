import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { HabitsConsole } from "@/components/HabitsConsole";

export default async function HabitsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Habits" meta="DAILY CHECK-INS · STREAKS · 14-DAY GRID" />
      <HabitsConsole />
    </AppShell>
  );
}
