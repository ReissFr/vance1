import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SubscriptionsConsole } from "@/components/SubscriptionsConsole";

export default async function SubscriptionsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Subscriptions" meta="RECURRING · MONTHLY EQUIV · AUTO-DETECTED" />
      <SubscriptionsConsole />
    </AppShell>
  );
}
