import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { OwedToMeConsole } from "@/components/OwedToMeConsole";

export default async function OwedToMePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Owed To Me"
        meta="THE PROMISES OTHERS MADE THAT YOU'RE QUIETLY WAITING ON · SHE SAID SHE'D · HE PROMISED · THEY SAID THEY'D GET BACK TO ME · THE CONTRACTOR SAID BY FRIDAY · MY DAD SAID HE'D HELP · CARRYING UNFULFILLED PROMISES IS REAL COGNITIVE WEIGHT · MOST OF US CARRY SEVERAL SILENTLY · WHO IS QUIETLY TAKING UP YOUR BANDWIDTH · BRING IT UP · NAME THE UNMET PROMISE · MAKE THE CONVERSATION"
      />
      <OwedToMeConsole />
    </AppShell>
  );
}
