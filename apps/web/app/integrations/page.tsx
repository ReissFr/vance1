import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { IntegrationsConsole } from "@/components/IntegrationsConsole";

export default async function IntegrationsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Integrations"
        meta="REAL CONNECTIONS · BRING YOUR OWN KEYS"
      />
      <IntegrationsConsole />
    </AppShell>
  );
}
