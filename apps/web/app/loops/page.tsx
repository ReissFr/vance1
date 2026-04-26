import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { LoopsConsole } from "@/components/LoopsConsole";

export default async function LoopsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Open loops"
        meta="EVERYTHING STILL ASKING FOR YOUR ATTENTION"
      />
      <LoopsConsole />
    </AppShell>
  );
}
