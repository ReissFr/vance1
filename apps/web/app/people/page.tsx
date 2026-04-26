import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PeopleConsole } from "@/components/PeopleConsole";

export default async function PeoplePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="People" meta="WHO MATTERS · INTERACTION JOURNAL · RECONNECT NUDGES" />
      <PeopleConsole />
    </AppShell>
  );
}
