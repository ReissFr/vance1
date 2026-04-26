import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ConstitutionConsole } from "@/components/ConstitutionConsole";

export default async function ConstitutionPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Constitution" meta="YOUR OWN LAWS · DISTILLED FROM YOUR OWN DATA · VERSIONED OVER TIME" />
      <ConstitutionConsole />
    </AppShell>
  );
}
