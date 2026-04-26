import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { MoneyConsole } from "@/components/MoneyConsole";

export default async function MoneyPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Money"
        meta="SPEND · WASTED · POTENTIAL SAVINGS"
      />
      <MoneyConsole />
    </AppShell>
  );
}
