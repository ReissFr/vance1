import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ContactProfileConsole } from "@/components/ContactProfileConsole";

export default async function ContactsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Contacts"
        meta="COUNTERPARTY PROFILES · COMMITMENTS · MEETINGS · RECALL"
      />
      <ContactProfileConsole />
    </AppShell>
  );
}
