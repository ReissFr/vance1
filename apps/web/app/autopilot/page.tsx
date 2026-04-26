import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AutopilotConsole } from "@/components/AutopilotConsole";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { Chip } from "@/components/jarvis/Chip";

export default async function AutopilotPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppShell>
      <PageHead
        title="Autopilot"
        meta="HANDS-OFF ACTIONS · YOUR RULES ARE LAW"
        right={
          <Chip color="var(--magenta)" border="var(--magenta-soft)">
            EXPERIMENTAL
          </Chip>
        }
      />
      <AutopilotConsole />
    </AppShell>
  );
}
