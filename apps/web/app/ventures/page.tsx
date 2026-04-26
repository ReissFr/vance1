import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { VenturesBoard } from "@/components/VenturesBoard";

export default async function VenturesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Ventures"
        meta="CEO MODE · BUSINESSES JARVIS IS RUNNING · DAILY OPERATOR LOOP · DECISION RIGHTS MATRIX · AUTO·NOTIFY·APPROVE TIERS · SILENT FOR SMALL REVERSIBLE · WHATSAPP FOR EVERYTHING ELSE · AUTO-KILL CRITERIA · OUTCOME POSTMORTEMS · YOU CHAIR THE BOARD JARVIS RUNS THE FLOOR"
      />
      <VenturesBoard />
    </AppShell>
  );
}
