import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { QuestionGraveyardConsole } from "@/components/QuestionGraveyardConsole";

export default async function QuestionGraveyardPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Question graveyard" meta="QUESTIONS YOU ASKED YOURSELF · INTO THE VOID · NEVER CLOSED · DECISIONS / SELF-INQUIRY / META · THE LONGER A QUESTION SITS UNANSWERED THE LOUDER IT GETS" />
      <QuestionGraveyardConsole />
    </AppShell>
  );
}
