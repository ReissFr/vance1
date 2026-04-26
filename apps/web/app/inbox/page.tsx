import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { InboxConsole } from "@/components/InboxConsole";

export default async function InboxPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Inbox"
        meta="TRIAGED BY JARVIS · REAL GMAIL · DRAFTS REVIEWED BEFORE SEND"
      />
      <InboxConsole />
    </AppShell>
  );
}
