import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { StandupConsole } from "@/components/StandupConsole";

export default async function StandupPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Standup" meta="YESTERDAY · TODAY · BLOCKERS · DAILY ACCOUNTABILITY" />
      <StandupConsole />
    </AppShell>
  );
}
