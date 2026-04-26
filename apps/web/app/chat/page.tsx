import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { Chat } from "@/components/Chat";

export default async function ChatPage() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <Chat />;
}
