import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { MorningBriefingConsole } from "@/components/MorningBriefingConsole";

export default async function MorningBriefingPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Morning briefing"
        meta="DAILY 07:00 · WHATSAPP · REVENUE · CALENDAR · WEATHER"
      />
      <MorningBriefingConsole />
    </AppShell>
  );
}
