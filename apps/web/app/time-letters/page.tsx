import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { TimeLettersConsole } from "@/components/TimeLettersConsole";

export default async function TimeLettersPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Time letters" meta="LETTERS ACROSS TIME · SEAL FOR THE FUTURE · GENERATE FROM THE PAST" />
      <TimeLettersConsole />
    </AppShell>
  );
}
