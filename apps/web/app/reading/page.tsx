import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ReadingConsole } from "@/components/ReadingConsole";

export default async function ReadingPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Reading" meta="READ-LATER · AUTO-SUMMARIZED · QUEUE" />
      <ReadingConsole />
    </AppShell>
  );
}
