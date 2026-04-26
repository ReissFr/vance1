import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SaidIWouldConsole } from "@/components/SaidIWouldConsole";

export default async function SaidIWouldPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Said I would"
        meta="EVERY CASUAL PROMISE YOU MADE IN PASSING · I'LL SEND THAT TOMORROW · I'LL CALL HER THIS WEEKEND · I'LL FIX IT NEXT WEEK · HORIZON INFERRED FROM YOUR LANGUAGE · FOLLOW-THROUGH RATE PER DOMAIN PER HORIZON · KEPT · PARTIAL · BROKEN · FORGOTTEN · THE GAP BETWEEN WHAT YOU SAY AND WHAT YOU DO MEASURED"
      />
      <SaidIWouldConsole />
    </AppShell>
  );
}
