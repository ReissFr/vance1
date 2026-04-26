import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { MirrorIndexConsole } from "@/components/MirrorIndexConsole";

export default async function MirrorIndexPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Mirror index" meta="WHO YOU MEASURE YOURSELF AGAINST · PAST SELF / PEERS / SIBLINGS / IDEAL SELF / FUTURE SELF / DOWNWARD · FAIRNESS 1 TO 5 · LIFTING OR PUNISHING · THE TARGETS YOU KEEP RETURNING TO" />
      <MirrorIndexConsole />
    </AppShell>
  );
}
