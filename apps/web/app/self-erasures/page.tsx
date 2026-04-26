import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SelfErasureConsole } from "@/components/SelfErasureConsole";

export default async function SelfErasuresPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Self-erasures" meta="WHEN YOU OVERRULED YOUR OWN THOUGHT MID-WAY · NEVER MIND / FORGET IT / I'M BEING SILLY / PROBABLY NOTHING / IGNORE ME · THE SECOND VOICE THAT KEEPS CANCELLING THE FIRST · RESTORE WHAT YOU WERE ABOUT TO SAY" />
      <SelfErasureConsole />
    </AppShell>
  );
}
