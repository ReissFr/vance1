import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { QuestionsConsole } from "@/components/QuestionsConsole";

export default async function QuestionsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Questions" meta="OPEN LOOPS · ANSWERS COMPOUND" />
      <QuestionsConsole />
    </AppShell>
  );
}
