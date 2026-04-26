import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { DigestView } from "@/components/DigestView";

export default async function EveningWrapPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Evening wrap"
        meta="DAILY 22:00 · WHAT YOU SHIPPED · WHAT'S OPEN · WHAT'S NEXT"
      />
      <DigestView
        latestEndpoint="/api/evening-wrap/latest"
        runEndpoint="/api/evening-wrap/run"
        historyEndpoint="/api/evening-wrap/history"
        kindLabel="Evening wrap"
        scheduleHint="Daily · 22:00 London"
        enabledToggleKey="evening_wrap_enabled"
      />
    </AppShell>
  );
}
