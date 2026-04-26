import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { CheckinsConsole } from "@/components/CheckinsConsole";

export default async function CheckinsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Check-ins" meta="DAILY · ENERGY · MOOD · FOCUS · TRENDS" />
      <CheckinsConsole />
    </AppShell>
  );
}
