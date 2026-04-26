import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { UsedToConsole } from "@/components/UsedToConsole";

export default async function UsedToPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Used To" meta="EVERY 'I USED TO ___' YOU HAVE TYPED · A LONGITUDINAL INVENTORY OF LOST SELVES · HOBBIES YOU STOPPED · HABITS YOU LET DROP · CAPABILITIES YOU MISS · PEOPLE YOU NO LONGER TALK TO · PLACES YOU LEFT · IDENTITIES YOU SHED · BELIEFS YOU OUTGREW · ROLES YOU HANDED BACK · RITUALS YOU BROKE · FOR EACH ONE: HOW OFTEN YOU MENTION IT · HOW MUCH LONGING YOU CARRY · AND ONE TEXTAREA TO RECLAIM IT BY PUTTING SOMETHING ON THE CALENDAR FOR TOMORROW" />
      <UsedToConsole />
    </AppShell>
  );
}
