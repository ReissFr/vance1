import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PremortemsConsole } from "@/components/PremortemsConsole";

export default async function PremortemsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Pre-mortems" meta="HOW EACH DECISION COULD FAIL · WATCH LIST" />
      <PremortemsConsole />
    </AppShell>
  );
}
