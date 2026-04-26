import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { GutCheckConsole } from "@/components/GutCheckConsole";

export default async function GutChecksPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Gut Checks"
        meta="THE FELT SIGNALS BEFORE THE REASONS · SOMETHING FEELS OFF · MY GUT SAYS · I JUST KNOW · I CAN'T PUT MY FINGER ON IT BUT · BAD FEELING · GOOD VIBES · PATTERN RECOGNITION OPERATING BELOW CONSCIOUS ANALYSIS · MOST PEOPLE EITHER OVER-TRUST OR UNDER-TRUST INTUITION WITHOUT MEASURING · YOUR GUT ACCURACY RATE EMPIRICALLY · THE QUADRANT MATRIX · FOLLOWED-AND-RIGHT · FOLLOWED-AND-WRONG · IGNORED-AND-REGRETTED · IGNORED-AND-RELIEVED · CALIBRATE WHAT YOU TRUST"
      />
      <GutCheckConsole />
    </AppShell>
  );
}
