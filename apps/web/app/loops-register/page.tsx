import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { LoopsRegisterConsole } from "@/components/LoopsRegisterConsole";

export default async function LoopsRegisterPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Loops register" meta="THE THEMES YOUR MIND KEEPS COMING BACK TO · QUESTIONS YOU CIRCLE · FEARS YOU REPLAY · SCENES YOU REWIND · CRAVINGS YOU REVISIT · GRIEVANCES THAT GNAW · TIME-WEIGHTED CHRONICITY · ESCALATING STABLE DAMPENING DORMANT · NOT EVERYTHING NEEDS RESOLVING · BREAK · WIDEN · SETTLE · ARCHIVE" />
      <LoopsRegisterConsole />
    </AppShell>
  );
}
