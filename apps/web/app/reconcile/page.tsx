import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ReconcileConsole } from "@/components/ReconcileConsole";

export default async function ReconcilePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Reconcile" meta="WHAT YOU SAID · WHAT YOU DID · WHERE THEY DIVERGE" />
      <ReconcileConsole />
    </AppShell>
  );
}
