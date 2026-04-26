import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { WinsConsole } from "@/components/WinsConsole";

export default async function WinsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Wins" meta="SHIPPED · SOLD · MILESTONES · PROOF OF MOTION" />
      <WinsConsole />
    </AppShell>
  );
}
