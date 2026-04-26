import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { FeatureLibrary } from "@/components/FeatureLibrary";
import { AppShell } from "@/components/jarvis/AppShell";

export default async function FeaturesPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <AppShell>
      <FeatureLibrary />
    </AppShell>
  );
}
