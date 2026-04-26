import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { IdentityConsole } from "@/components/IdentityConsole";

export default async function IdentityPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Identity" meta="WHO YOU ARE IN YOUR OWN WORDS · DRIFT TRACKED OVER TIME" />
      <IdentityConsole />
    </AppShell>
  );
}
