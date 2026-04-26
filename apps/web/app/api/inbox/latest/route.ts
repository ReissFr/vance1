// Returns the most recent inbox-triage task (whether needs_approval or done)
// so the /inbox page can render real classifications + drafts instead of
// hardcoded fixtures. Also reports whether the user has an active Gmail
// integration so the UI can offer "Connect Gmail" when nothing's wired.

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type InboxEntry = {
  email: {
    id: string;
    thread_id: string;
    from: string;
    to?: string;
    subject: string;
    snippet?: string;
    body?: string;
    received_at?: string;
    message_id_header?: string;
  };
  classification: "needs_reply" | "fyi" | "newsletter" | "spam" | "action_required";
  priority: "high" | "medium" | "low";
  reason: string;
  suggested_reply?: { subject: string; body: string };
};

type InboxResult = {
  query: string;
  count: number;
  entries: InboxEntry[];
};

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { data: integ } = await supabase
    .from("integrations")
    .select("id, active")
    .eq("user_id", user.id)
    .eq("kind", "email")
    .eq("provider", "gmail")
    .eq("active", true)
    .maybeSingle();
  const gmailConnected = Boolean(integ?.id);

  const { data: task } = await supabase
    .from("tasks")
    .select("id, status, result, error, created_at, completed_at, args, needs_approval_at")
    .eq("user_id", user.id)
    .eq("kind", "inbox")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let result: InboxResult | null = null;
  if (task?.result) {
    try {
      result = typeof task.result === "string"
        ? (JSON.parse(task.result) as InboxResult)
        : (task.result as InboxResult);
    } catch {
      result = null;
    }
  }

  return NextResponse.json({
    ok: true,
    gmail_connected: gmailConnected,
    task: task
      ? {
          id: task.id,
          status: task.status,
          error: task.error,
          created_at: task.created_at,
          completed_at: task.completed_at,
          needs_approval_at: task.needs_approval_at,
          title: (task.args as { title?: string } | null)?.title ?? "Inbox triage",
        }
      : null,
    result,
  });
}
