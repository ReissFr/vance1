import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SkillsConsole } from "@/components/SkillsConsole";

export default async function SkillsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Skills"
        meta="INSTALLED · LEARNED BY DOING · REPLAYABLE"
      />
      <SkillsConsole />
    </AppShell>
  );
}
