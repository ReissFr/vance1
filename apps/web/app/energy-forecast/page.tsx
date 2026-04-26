import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { EnergyForecastConsole } from "@/components/EnergyForecastConsole";

export default async function EnergyForecastPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Energy forecast" meta="PREDICT TOMORROW · YOUR BODY, MODELLED · CALIBRATION OVER TIME" />
      <EnergyForecastConsole />
    </AppShell>
  );
}
