import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SoulMapConsole } from "@/components/SoulMapConsole";

export default async function SoulMapPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Soul map" meta="THE SHAPE OF WHO YOU ARE · CLUSTERS, TENSIONS, ANCHORS · DATED AND COMPARABLE" />
      <SoulMapConsole />
    </AppShell>
  );
}
