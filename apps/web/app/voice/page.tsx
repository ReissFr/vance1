import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { BrandVoiceConsole } from "@/components/BrandVoiceConsole";

export default async function VoicePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Brand voice" meta="HOW YOU SOUND · APPLIED TO EVERY DRAFT" />
      <BrandVoiceConsole />
    </AppShell>
  );
}
