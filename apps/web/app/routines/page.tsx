import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { RoutinesConsole } from "@/components/RoutinesConsole";

export default async function RoutinesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Routines" meta="NAMED CHECKLISTS · ORDERED STEPS · FIRE BY NAME" />
      <RoutinesConsole />
    </AppShell>
  );
}
