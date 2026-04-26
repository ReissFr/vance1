import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PhantomLimbsConsole } from "@/components/PhantomLimbsConsole";

export default async function PhantomLimbsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Phantom limbs" meta="THINGS YOU SAID YOU PUT DOWN BUT KEEP BRINGING UP · MOVE-ON CLAIMS THAT NEVER STUCK · WHAT THE WORDS LET GO OF AND THE BODY DIDN'T" />
      <PhantomLimbsConsole />
    </AppShell>
  );
}
