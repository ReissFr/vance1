import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SearchConsole } from "@/components/SearchConsole";

export default async function SearchPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead
        title="Search"
        meta="EVERY JOURNAL LAYER · ONE QUERY"
      />
      <SearchConsole />
    </AppShell>
  );
}
