import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { PermissionSlipsConsole } from "@/components/PermissionSlipsConsole";

export default async function PermissionSlipsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Permission Slips"
        meta="THE THINGS YOU REFUSE YOURSELF · I CAN'T · I'M NOT ALLOWED TO · IT'S NOT FOR ME · I'M NOT THE KIND OF PERSON WHO · EVERY REFUSAL HAS A SIGNER · WHO HOLDS THE PEN · PARENT OR PARTNER OR PEERS OR SOCIETY OR EMPLOYER OR PROFESSION OR CIRCUMSTANCE OR YOU · SIGN IT YOURSELF · OR REFUSE THE AUTHORITY · OR ACCEPT IT EYES OPEN"
      />
      <PermissionSlipsConsole />
    </AppShell>
  );
}
