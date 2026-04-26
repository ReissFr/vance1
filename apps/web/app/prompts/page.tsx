import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { SavedPromptsConsole } from "@/components/SavedPromptsConsole";

export default async function PromptsPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Saved prompts" meta="REUSABLE INSTRUCTIONS · FIRE BY NAME" />
      <SavedPromptsConsole />
    </AppShell>
  );
}
