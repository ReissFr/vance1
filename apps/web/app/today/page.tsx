import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { TodayBoard } from "@/components/TodayBoard";

export default async function TodayPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Today"
        meta="LIVE · CALENDAR · INBOX · REVENUE · RENEWALS · APPROVALS"
      />
      <TodayBoard />
    </AppShell>
  );
}
