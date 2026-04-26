import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { IdeasConsole } from "@/components/IdeasConsole";

export default async function IdeasPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Ideas" meta="SHOWER THOUGHTS · ANGLES · WHAT-IFS" />
      <IdeasConsole />
    </AppShell>
  );
}
