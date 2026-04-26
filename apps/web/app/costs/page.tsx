import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { LlmCostConsole } from "@/components/LlmCostConsole";

export default async function CostsPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Costs" meta="LLM SPEND · TOKENS · PER MODEL" />
      <LlmCostConsole />
    </AppShell>
  );
}
