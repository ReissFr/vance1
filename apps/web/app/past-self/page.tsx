import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PastSelfConsole } from "@/components/PastSelfConsole";

export default async function PastSelfPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Past self" meta="TALK TO YOU FROM 3, 6, 12, 24 OR 36 MONTHS AGO" />
      <PastSelfConsole />
    </AppShell>
  );
}
