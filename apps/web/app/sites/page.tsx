import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SitesConsole } from "@/components/SitesConsole";

export default async function SitesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Sites"
        meta="PRE-SIGN-IN · PERSISTENT SESSIONS · ONE-TAP LOGIN"
      />
      <SitesConsole />
    </AppShell>
  );
}
