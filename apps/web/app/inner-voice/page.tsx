import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { InnerVoiceConsole } from "@/components/InnerVoiceConsole";

export default async function InnerVoicePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Inner voice atlas" meta="WHO INSIDE YOU IS SPEAKING · CRITIC / DREAMER / CALCULATOR / FRIGHTENED / SOLDIER / PHILOSOPHER / VICTIM / COACH / COMEDIAN / SCHOLAR" />
      <InnerVoiceConsole />
    </AppShell>
  );
}
