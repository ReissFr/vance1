import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ReverseBriefsConsole } from "@/components/ReverseBriefsConsole";

export default async function ReverseBriefsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Reverse brief" meta="WHAT YOUR DAY REVEALS YOU IMPLICITLY BELIEVED · ARCHAEOLOGY OF BELIEF FROM ACTION · CONTEST OR ACKNOWLEDGE" />
      <ReverseBriefsConsole />
    </AppShell>
  );
}
