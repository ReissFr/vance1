import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ReflectionsConsole } from "@/components/ReflectionsConsole";

export default async function ReflectionsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Reflections"
        meta="LESSONS · REGRETS · REALISATIONS · GRATITUDE"
      />
      <ReflectionsConsole />
    </AppShell>
  );
}
