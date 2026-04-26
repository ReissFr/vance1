import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { BeliefContradictionsConsole } from "@/components/BeliefContradictionsConsole";

export default async function BeliefContradictionsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Belief vs behaviour" meta="WHERE WHAT YOU SAID YOU VALUE CLASHES WITH WHAT YOU ACTUALLY DID" />
      <BeliefContradictionsConsole />
    </AppShell>
  );
}
