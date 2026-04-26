import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { GoalsConsole } from "@/components/GoalsConsole";

export default async function GoalsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Goals" meta="QUARTERLY · MONTHLY · MILESTONES · PROGRESS" />
      <GoalsConsole />
    </AppShell>
  );
}
