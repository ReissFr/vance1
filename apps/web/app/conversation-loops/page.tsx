import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ConversationLoopsConsole } from "@/components/ConversationLoopsConsole";

export default async function ConversationLoopsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Conversation loops" meta="QUESTIONS YOU KEEP CIRCLING · NAMED, RESOLVED, OR DISMISSED · MINED FROM YOUR CHAT HISTORY" />
      <ConversationLoopsConsole />
    </AppShell>
  );
}
