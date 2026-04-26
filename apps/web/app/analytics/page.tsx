import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { AnalyticsConsole } from "@/components/AnalyticsConsole";

export default async function AnalyticsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Analytics" meta="PAGEVIEWS · EVENTS · POSTHOG-MIRRORED" />
      <AnalyticsConsole />
    </AppShell>
  );
}
