import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PoliciesConsole } from "@/components/PoliciesConsole";

export default async function PoliciesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Policies" meta="RULES THE BRAIN ENFORCES · YOUR BOUNDARIES" />
      <PoliciesConsole />
    </AppShell>
  );
}
