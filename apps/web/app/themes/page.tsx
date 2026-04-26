import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ThemesConsole } from "@/components/ThemesConsole";

export default async function ThemesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Themes" meta="NARRATIVE THREADS · WHAT YOU'RE LIVING THROUGH" />
      <ThemesConsole />
    </AppShell>
  );
}
