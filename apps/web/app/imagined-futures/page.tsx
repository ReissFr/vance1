import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ImaginedFuturesConsole } from "@/components/ImaginedFuturesConsole";

export default async function ImaginedFuturesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Imagined-future register" meta="FUTURES YOU'VE BEEN VISITING MENTALLY · THE LIFE YOU PICTURE WHEN YOU LOOK UP · THE VERSION OF YOU IN ANOTHER CITY · IN ANOTHER ROLE · WITH ANOTHER PERSON · WITH ANOTHER NAME · WHICH PULL IS GENUINE · WHICH IS A PRESSURE-RELEASE VALVE · WHICH IS GRIEF FOR A PATH ALREADY CLOSED · WHICH IS IDLE WONDERING · PURSUE OR RELEASE OR SIT WITH OR GRIEVE · NAMING WHICH IS THE MOVE" />
      <ImaginedFuturesConsole />
    </AppShell>
  );
}
