import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { LatentDecisionsConsole } from "@/components/LatentDecisionsConsole";

export default async function LatentDecisionsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Latent decisions" meta="DECISIONS YOU MADE BY DEFAULT · NAMED, NOT JUDGED · ACKNOWLEDGE OR CONTEST" />
      <LatentDecisionsConsole />
    </AppShell>
  );
}
