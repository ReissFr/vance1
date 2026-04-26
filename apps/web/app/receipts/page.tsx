import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ReceiptsConsole } from "@/components/ReceiptsConsole";

export default async function ReceiptsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Receipts"
        meta="ONE-OFF · PURCHASES · EMAIL-EXTRACTED"
      />
      <ReceiptsConsole />
    </AppShell>
  );
}
