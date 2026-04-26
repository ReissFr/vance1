import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { TrajectoriesConsole } from "@/components/TrajectoriesConsole";

export default async function TrajectoriesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Trajectories" meta="WHERE YOU END UP IF YOU DON'T CHANGE COURSE · 6M & 12M PROJECTIONS" />
      <TrajectoriesConsole />
    </AppShell>
  );
}
