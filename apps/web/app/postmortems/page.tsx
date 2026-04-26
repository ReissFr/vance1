import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PostmortemConsole } from "@/components/PostmortemConsole";

export default async function PostmortemsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Postmortems" meta="DECISIONS, REVISITED · PREDICTION VS REALITY · CALIBRATION OVER TIME" />
      <PostmortemConsole />
    </AppShell>
  );
}
