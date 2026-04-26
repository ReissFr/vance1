import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { BirthdaysConsole } from "@/components/BirthdaysConsole";

export default async function BirthdaysPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Birthdays" meta="UPCOMING · ANNIVERSARIES · LEAD-TIME NUDGES" />
      <BirthdaysConsole />
    </AppShell>
  );
}
