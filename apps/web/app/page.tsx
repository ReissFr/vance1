import { redirect } from "next/navigation";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { Home } from "@/components/Home";

export default async function Page() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("onboarded_at")
    .eq("id", user.id)
    .single();
  if (!profile?.onboarded_at) redirect("/onboarding");

  const name =
    (user.user_metadata?.preferred_name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ??
    null;

  return <Home user={{ name, email: user.email ?? null }} />;
}
