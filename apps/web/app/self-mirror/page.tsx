import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SelfMirrorConsole } from "@/components/SelfMirrorConsole";

export default async function SelfMirrorPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Self-mirror" meta="HOW YOU APPEAR · IN YOUR OWN WORDS · DATED AND COMPARABLE" />
      <SelfMirrorConsole />
    </AppShell>
  );
}
