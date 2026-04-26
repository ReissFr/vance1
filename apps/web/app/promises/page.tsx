import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PromisesConsole } from "@/components/PromisesConsole";

export default async function PromisesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Promise ledger" meta="EVERY SELF-PROMISE IN YOUR OWN MESSAGES · KEPT, BROKEN, OR PENDING · YOUR SELF-TRUST RATE" />
      <PromisesConsole />
    </AppShell>
  );
}
