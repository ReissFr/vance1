import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SettingsPanel } from "@/components/SettingsPanel";

export default async function SettingsRoute() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name =
    (user.user_metadata?.preferred_name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined) ??
    "";

  return (
    <AppShell>
      <PageHead
        title="Settings"
        meta="PREFERENCES · VOICE · BOUNDARIES"
      />
      <SettingsPanel email={user.email ?? ""} name={name} />
    </AppShell>
  );
}
