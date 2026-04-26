import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { FocusConsole } from "@/components/FocusConsole";

export default async function FocusPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Focus" meta="DO-NOT-DISTURB · TIMER · PROACTIVE MUTED" />
      <FocusConsole />
    </AppShell>
  );
}
