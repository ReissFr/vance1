import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { HistoryConsole } from "@/components/HistoryConsole";

export default async function HistoryPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="History"
        meta="CONVERSATIONS · SEARCHABLE · EXPORTABLE"
      />
      <HistoryConsole />
    </AppShell>
  );
}
