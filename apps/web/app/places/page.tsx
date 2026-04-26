import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PlacesConsole } from "@/components/PlacesConsole";

export default async function PlacesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Places"
        meta="YOUR MAP · NAMED PLACES · LIVE POSITION"
      />
      <PlacesConsole />
    </AppShell>
  );
}
