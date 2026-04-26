import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ThresholdsConsole } from "@/components/ThresholdsConsole";

export default async function ThresholdsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Threshold ledger" meta="MOMENTS WHERE PAST SELF WOULD NOT RECOGNISE PRESENT SELF · I NEVER THOUGHT I WOULD · I USED TO THINK I COULDN'T · NOW I'M SOMEONE WHO · SINCE WHEN DID I · BEFORE STATE AND AFTER STATE NAMED · CHARGE GROWTH OR DRIFT (POSITIVE CROSSING OR WORRYING ONE) · PIVOT KIND CAPABILITY BELIEF BOUNDARY HABIT IDENTITY AESTHETIC RELATIONAL MATERIAL · MAGNITUDE 1 TO 5 · INTEGRATE AS IDENTITY EVIDENCE · DISPUTE THE FRAMING · DISMISS A FALSE ALARM · A REGISTER OF WHO YOU ARE BECOMING" />
      <ThresholdsConsole />
    </AppShell>
  );
}
