import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { VowsConsole } from "@/components/VowsConsole";

export default async function VowsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Vow ledger" meta="PROMISES YOU MADE TO YOURSELF · I ALWAYS · I NEVER · I PROMISED MYSELF · I SWORE I WOULD NEVER · I'M THE KIND OF PERSON WHO · CHILDHOOD VOWS STILL OPERATIVE · THE SHADOW EACH VOW CASTS · WHAT IT FORECLOSES · RENEW OR REVISE OR RELEASE OR HONOUR · A LEDGER OF YOUR UNEXAMINED COMMITMENTS · CONSTITUTIONAL REVIEW OF THE SELF" />
      <VowsConsole />
    </AppShell>
  );
}
