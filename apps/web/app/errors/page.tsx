import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ErrorsConsole } from "@/components/ErrorsConsole";

export default async function ErrorsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Errors" meta="SERVER-SIDE · LAST 7 DAYS · SENTRY-MIRRORED" />
      <ErrorsConsole />
    </AppShell>
  );
}
