import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { CounterfactualsConsole } from "@/components/CounterfactualsConsole";

export default async function CounterfactualsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Counterfactuals" meta="THE PATH NOT TAKEN · REPLAYED" />
      <CounterfactualsConsole />
    </AppShell>
  );
}
