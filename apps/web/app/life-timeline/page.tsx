import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { LifeTimelineConsole } from "@/components/LifeTimelineConsole";

export default async function LifeTimelinePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Life timeline" meta="YOUR STORY, STITCHED · CHAPTERS, NOT ENTRIES · DATED AND COMPARABLE" />
      <LifeTimelineConsole />
    </AppShell>
  );
}
