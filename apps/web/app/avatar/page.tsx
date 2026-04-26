import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { AvatarConsole } from "@/components/AvatarConsole";

export default async function AvatarPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <AvatarConsole />;
}
