import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PermissionLedgerConsole } from "@/components/PermissionLedgerConsole";

export default async function PermissionLedgerPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Permission ledger" meta="WHEN YOU ASKED FOR AUTHORISATION YOU SHOULDN'T HAVE NEEDED · IS IT OK IF / I SHOULDN'T BUT / IS IT BAD THAT I / DO MOST PEOPLE / I'M GOING TO BUT · THE AUDIENCES YOU IMAGINE MIGHT DISAPPROVE · GRANT YOURSELF PERMISSION" />
      <PermissionLedgerConsole />
    </AppShell>
  );
}
