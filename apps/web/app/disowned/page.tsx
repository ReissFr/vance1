import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { DisownedConsole } from "@/components/DisownedConsole";

export default async function DisownedPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Disowned" meta="WHEN YOU DESCRIBED YOUR OWN LIFE AS IF IT WERE SOMEONE ELSE'S · 'THE DEPRESSION HIT' / 'THE CHEST TIGHTENS' / 'YOU KNOW THAT FEELING' / 'EVERYONE HAS THIS' / 'THE GYM WASN'T VISITED' · THE SPECTATOR VOICE NARRATING YOU FROM OUTSIDE · RECLAIM IT AS YOURS — IN I-FORM, ACTIVE VOICE" />
      <DisownedConsole />
    </AppShell>
  );
}
