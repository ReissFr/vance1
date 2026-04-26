import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { EchoJournalConsole } from "@/components/EchoJournalConsole";

export default async function EchoesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Echo journal" meta="MOMENTS WHERE YOU'VE WALKED INTO THE SAME ROOM TWICE" />
      <EchoJournalConsole />
    </AppShell>
  );
}
