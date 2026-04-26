import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { FutureSelfConsole } from "@/components/FutureSelfConsole";

export default async function FutureSelfPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Future self" meta="TALK TO YOU FROM 6, 12 OR 60 MONTHS FROM NOW" />
      <FutureSelfConsole />
    </AppShell>
  );
}
