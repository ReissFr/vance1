import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { CommitmentsConsole } from "@/components/CommitmentsConsole";

export default async function CommitmentsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Commitments"
        meta="PROMISES · INBOUND · OUTBOUND · DEADLINES"
      />
      <CommitmentsConsole />
    </AppShell>
  );
}
