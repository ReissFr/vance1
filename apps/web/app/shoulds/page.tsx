import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ShouldsConsole } from "@/components/ShouldsConsole";

export default async function ShouldsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Should Ledger" meta="EVERY 'I SHOULD ___' YOU HAVE TYPED · A LONGITUDINAL INVENTORY OF UNMET OBLIGATIONS · MORAL OUGHTS · PRACTICAL CHORES · SOCIAL CALL-BACKS · RELATIONAL DEBTS · HEALTH RESOLVES · IDENTITY DEMANDS · WORK PRESSURES · FINANCIAL MORALS · FOR EACH ONE: WHOSE VOICE PUT IT THERE · YOUR OWN · A PARENT'S · A PARTNER'S · YOUR INNER CRITIC · A SOCIAL NORM · A PROFESSIONAL NORM · A FINANCIAL JUDGE · OR JUST AN ABSTRACT OTHER · THREE OUTCOMES PER ROW · DO IT (CONVERT TO A PROMISE) · RELEASE IT (THIS ISN'T MINE TO CARRY) · DONE (ALREADY HANDLED)" />
      <ShouldsConsole />
    </AppShell>
  );
}
