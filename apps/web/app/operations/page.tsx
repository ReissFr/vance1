import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { OperationsBoard } from "@/components/OperationsBoard";

export default async function OperationsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name =
    (user.user_metadata?.preferred_name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    null;

  return (
    <AppShell>
      <PageHead
        title="Operations"
        meta="LIVE · WHAT I'M HANDLING FOR YOU"
      />
      <OperationsBoard fallbackName={name} />
    </AppShell>
  );
}
