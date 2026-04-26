import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { InnerCouncilConsole } from "@/components/InnerCouncilConsole";

export default async function InnerCouncilPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Inner council"
        meta="ASK ONE QUESTION · HEAR FROM SIX VOICES OF YOU"
      />
      <InnerCouncilConsole />
    </AppShell>
  );
}
