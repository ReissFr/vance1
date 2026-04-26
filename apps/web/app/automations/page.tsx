import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { AutomationsConsole } from "@/components/AutomationsConsole";

export default async function AutomationsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Automations"
        meta="IF · THEN · TRIGGERED BY YOUR LIFE"
      />
      <AutomationsConsole />
    </AppShell>
  );
}
