import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { RetrospectiveConsole } from "@/components/RetrospectiveConsole";

export default async function RetrospectivePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Retrospective" meta="WHAT MATTERED · SHIPPED · LEARNED · DECIDED · STUCK" />
      <RetrospectiveConsole />
    </AppShell>
  );
}
