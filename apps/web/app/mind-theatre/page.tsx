import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AppShell } from "@/components/jarvis/AppShell";
import { PageHead } from "@/components/jarvis/PageHead";
import { TheatreConsole } from "@/components/TheatreConsole";

export default async function MindTheatrePage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <AppShell>
      <PageHead title="Mind Theatre" meta="CONVENE THE VOICE CABINET ON A QUESTION YOU ARE SITTING WITH · NAME THE THING · EACH VOICE SPEAKS IN CHARACTER · MUM PARTNER INNER CRITIC FOUNDER MONEY JUDGE FUTURE SELF · STANCE PUSH PULL PROTECT CAUTION AMBIVALENT · A SHORT REPLY IN FIRST PERSON · THE REASONING IN THIRD PERSON · THEN YOU PICK · WENT WITH THIS VOICE (IT GETS AIRTIME) · OVERRIDE EVERYONE (WRITE YOUR OWN ANSWER) · SILENCE THIS VOICE (IT DOES NOT GET A VOTE ON THIS ONE) · OR SIT WITH IT UNRESOLVED · THE PANEL EXTERNALISES THE NOISE · THE OUTCOME RESHAPES THE CABINET" />
      <TheatreConsole />
    </AppShell>
  );
}
