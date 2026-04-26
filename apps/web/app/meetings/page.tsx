import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { MeetingsHub } from "@/components/MeetingsHub";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";

export default async function MeetingsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppShell live={{ mtg: false }}>
      <PageHead
        title="Meetings"
        meta="TRANSCRIPTS · SUMMARIES · LIVE COACHING"
      />
      <MeetingsHub />
    </AppShell>
  );
}
