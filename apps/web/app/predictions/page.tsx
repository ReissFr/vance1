import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PredictionsConsole } from "@/components/PredictionsConsole";

export default async function PredictionsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Predictions" meta="FORECASTS WITH CONFIDENCE · CALIBRATION OVER TIME" />
      <PredictionsConsole />
    </AppShell>
  );
}
