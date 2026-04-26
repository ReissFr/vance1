import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ObservationsConsole } from "@/components/ObservationsConsole";

export default async function ObservationsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Inner monologue" meta="WHAT THE BRAIN HAS NOTICED · BACKGROUND OBSERVATIONS" />
      <ObservationsConsole />
    </AppShell>
  );
}
