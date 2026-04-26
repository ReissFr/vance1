import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { FearConsole } from "@/components/FearConsole";

export default async function FearsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Fears"
        meta="THE FEARS YOU'VE ARTICULATED · I'M AFRAID THAT · I WORRY THAT · WHAT IF · MY BIGGEST FEAR · IT TERRIFIES ME · I KEEP HAVING THIS FEAR · MEASURED EMPIRICALLY AGAINST WHAT ACTUALLY HAPPENED · FEAR REALISATION RATE · OVERRUN RATE · MOST PEOPLE CARRY EVERY FEAR AT FULL CHARGE BECAUSE THEY NEVER MEASURE · YOUR ALARM SYSTEM CALIBRATION · WHICH FEAR FLAVOURS ARE PROPHETIC · WHICH ARE BANDWIDTH OVERRUN"
      />
      <FearConsole />
    </AppShell>
  );
}
