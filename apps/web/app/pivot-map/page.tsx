import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PivotMapConsole } from "@/components/PivotMapConsole";

export default async function PivotMapPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Pivot map" meta="THE MOMENTS YOU TURNED · VERBAL PIVOTS / STANCE REVERSALS / ABANDONMENTS / RECOMMITMENTS · DID THE PIVOT STICK OR DID YOU SLIDE BACK" />
      <PivotMapConsole />
    </AppShell>
  );
}
