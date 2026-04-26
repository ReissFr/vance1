import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { InsightsConsole } from "@/components/InsightsConsole";

export default async function InsightsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Insights" meta="WEEK-OVER-WEEK · TASKS · SPEND · COMMITMENTS" />
      <InsightsConsole />
    </AppShell>
  );
}
