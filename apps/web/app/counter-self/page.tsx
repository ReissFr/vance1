import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { CounterSelfConsole } from "@/components/CounterSelfConsole";

export default async function CounterSelfPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Counter-self chamber" meta="THE STRONGEST POSSIBLE ADVERSARY · FIVE VOICES · ENGAGE OR UPDATE OR DEFER" />
      <CounterSelfConsole />
    </AppShell>
  );
}
