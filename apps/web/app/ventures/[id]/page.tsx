import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { VentureDetail } from "@/components/VentureDetail";

type Params = { params: Promise<{ id: string }> };

export default async function VentureDetailPage({ params }: Params) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;

  return (
    <AppShell>
      <PageHead
        title="Venture"
        back="VENTURES"
        meta="OPERATOR MEMORY · LIVE STRATEGY DOC · DECISION QUEUE · SIGNAL STREAM · METRICS · HEARTBEAT · KILL CRITERIA · AUTONOMY MATRIX"
      />
      <VentureDetail ventureId={id} />
    </AppShell>
  );
}
