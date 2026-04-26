import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { AlmostsConsole } from "@/components/AlmostsConsole";

export default async function AlmostsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Almost-register" meta="MOMENTS WHERE YOU ALMOST DID IT AND PULLED BACK · WHAT YOU NEARLY SAID · WHAT YOU NEARLY SENT · WHAT YOU NEARLY QUIT · WHAT STOPPED YOU · WAS THE BRAKE WISDOM OR FEAR · RELIEF OR REGRET · HONOUR THE BRAKE OR MOURN WHAT YOU ALMOST DID OR TRY AGAIN NOW · A REGISTER OF NEAR-MISSES · THE LINE YOU STOPPED AT" />
      <AlmostsConsole />
    </AppShell>
  );
}
