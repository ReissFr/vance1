import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { DigestView } from "@/components/DigestView";

export default async function WeeklyReviewPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Weekly review"
        meta="SUNDAY 18:00 · THE WEEK'S PATTERN · STANDOUTS · WHAT TO KILL"
      />
      <DigestView
        latestEndpoint="/api/weekly-review/latest"
        runEndpoint="/api/weekly-review/run"
        historyEndpoint="/api/weekly-review/history"
        kindLabel="Weekly review"
        scheduleHint="Weekly · Sunday 18:00 London"
        enabledToggleKey="weekly_review_enabled"
      />
    </AppShell>
  );
}
