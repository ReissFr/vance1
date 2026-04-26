import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { Chip } from "@/components/jarvis/Chip";
import { WatchersConsole } from "@/components/WatchersConsole";

export default async function WatchersPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppShell>
      <PageHead
        title="Watchers"
        meta="AMBIENT RULES · JARVIS FIRES THESE ON ITS OWN"
        right={
          <Chip color="var(--indigo)" border="var(--indigo-soft)">
            ALWAYS ON
          </Chip>
        }
      />
      <WatchersConsole />
    </AppShell>
  );
}
