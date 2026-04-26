import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { KnowledgeCardsConsole } from "@/components/KnowledgeCardsConsole";

export default async function CardsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Knowledge cards" meta="ATOMIC FACTS · QUOTES · PRINCIPLES · PLAYBOOKS" />
      <KnowledgeCardsConsole />
    </AppShell>
  );
}
