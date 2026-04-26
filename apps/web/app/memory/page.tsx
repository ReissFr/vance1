import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { MemoryConsole } from "@/components/MemoryConsole";

export default async function MemoryPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Memory"
        meta="WHAT JARVIS REMEMBERS · FACTS · PEOPLE · PREFERENCES"
      />
      <MemoryConsole />
    </AppShell>
  );
}
