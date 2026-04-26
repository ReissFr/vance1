import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { ContradictionsConsole } from "@/components/ContradictionsConsole";

export default async function ContradictionsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Contradictions"
        meta="WHERE YOU SAY ONE THING AND ANOTHER · CROSS-TIME PAIRS · YOU SAID X · LATER YOU SAID NOT-X · TWO STATEMENTS THAT CANNOT BOTH FULLY BE TRUE · OR PULL OPPOSITE WAYS · DUAL HOLDS BOTH · EVOLVED SAYS THE LATER IS NOW · CONFUSED HOLDS THE QUESTION OPEN · DAYS APART NAMES HOW LONG IT HAS STOOD"
      />
      <ContradictionsConsole />
    </AppShell>
  );
}
