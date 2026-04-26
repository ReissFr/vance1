import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PatternsConsole } from "@/components/PatternsConsole";

export default async function PatternsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Pattern library" meta="CAUSAL PATTERNS IN YOUR OWN DATA · WHAT TENDS TO PRECEDE WHAT · CONFIRM OR CONTEST" />
      <PatternsConsole />
    </AppShell>
  );
}
