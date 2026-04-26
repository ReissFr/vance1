import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { RecallSearch } from "@/components/RecallSearch";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";

export default async function RecallPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppShell>
      <PageHead
        title="Recall"
        meta="EVERYTHING JARVIS HAS SEEN · SEARCHABLE"
      />
      <div style={{ padding: "8px 0" }}>
        <RecallSearch />
      </div>
    </AppShell>
  );
}
