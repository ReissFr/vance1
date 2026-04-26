import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { LettersConsole } from "@/components/LettersConsole";

export default async function LettersPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Letters across time" meta="LETTERS TO YOUR FUTURE SELF · LETTERS TO YOUR PAST SELF · LETTERS TO YOUR YOUNGER SELF · EVERY LETTER CARRIES A STATE-VECTOR SNAPSHOT · WHO YOU WERE WHEN YOU WROTE IT · WHO THEY WERE WHEN YOU WROTE TO THEM · TIME CAPSULES WITH PROOF · DELIVERED ON THEIR DATE · NOT JUST WORDS BUT EVIDENCE" />
      <LettersConsole />
    </AppShell>
  );
}
