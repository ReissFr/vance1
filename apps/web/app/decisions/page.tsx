import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { DecisionsConsole } from "@/components/DecisionsConsole";

export default async function DecisionsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Decisions" meta="LOG · REVIEW · LABEL · CARRY THE LESSONS" />
      <DecisionsConsole />
    </AppShell>
  );
}
