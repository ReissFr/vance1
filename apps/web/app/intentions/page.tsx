import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { IntentionsConsole } from "@/components/IntentionsConsole";

export default async function IntentionsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Intentions" meta="ONE PER DAY · CARRY-FORWARD · TIMELINE" />
      <IntentionsConsole />
    </AppShell>
  );
}
