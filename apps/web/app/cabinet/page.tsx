import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { CabinetConsole } from "@/components/CabinetConsole";

export default async function CabinetPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Voice Cabinet" meta="THE DISCRETE VOICES THAT AUTHOR YOUR UNMET OBLIGATIONS · DERIVED FROM YOUR SHOULD LEDGER · ONE ROW PER VOICE · A PARENT'S VOICE · A PARTNER'S · THE INNER CRITIC · A SOCIAL NORM · A PROFESSIONAL NORM · A FINANCIAL JUDGE · OR A DIFFUSE OTHER · FOR EACH ONE · AIRTIME · INFLUENCE SEVERITY · TYPICAL DEMANDS · THREE RESOLUTION MODES · ACKNOWLEDGE (YOU ARE HEARD) · INTEGRATE (KEEP THE WISDOM · NAME WHAT) · RETIRE (YOU NO LONGER HAVE AUTHORITY OVER ME · NAME WHY) · A CABINET OF VOICES YOU CONSCIOUSLY AUTHOR" />
      <CabinetConsole />
    </AppShell>
  );
}
