import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PreWriteConsole } from "@/components/PreWriteConsole";

export default async function PreWritePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Pre-write" meta="DRAFTS BEFORE THE BLANK PAGE · YOUR VOICE, PRE-FILLED · ACCEPTANCE FEEDBACK" />
      <PreWriteConsole />
    </AppShell>
  );
}
