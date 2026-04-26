// Approves a writer task draft and performs the send-ready step for its
// format:
//   email / cold_outreach → creates an email provider draft (user reviews + sends)
//   linkedin_post         → returns a prefilled LinkedIn share compose URL
//   tweet                 → returns a prefilled X compose URL
//   whatsapp_reply / general → returns the text for client-side copy
//
// Email draft creation goes through the user's configured EmailProvider
// (Gmail today; Outlook/IMAP pluggable via @jarvis/integrations).

import { type NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmailProvider, type EmailProvider } from "@jarvis/integrations";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Body = { to?: string; prospect_emails?: string[]; email_ids?: string[] };
type Format = "email" | "linkedin_post" | "whatsapp_reply" | "tweet" | "cold_outreach" | "general";

type OutreachDraft = {
  prospect: { name: string; email: string; company?: string; role?: string; context?: string };
  subject: string;
  body: string;
  error?: string;
};
type OutreachStored = { campaign_goal: string; drafts: OutreachDraft[] };

type InboxEntry = {
  email: {
    id: string;
    thread_id: string;
    from: string;
    to: string;
    subject: string;
    message_id_header: string;
  };
  classification: string;
  priority: string;
  reason: string;
  suggested_reply?: { subject: string; body: string };
};
type InboxStored = { query: string; count: number; entries: InboxEntry[] };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: taskId } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty body is fine for non-email formats
  }

  const admin = supabaseAdmin();
  const { data: task, error: taskErr } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .eq("user_id", auth.user.id)
    .single();
  if (taskErr || !task) {
    return NextResponse.json({ ok: false, error: "task not found" }, { status: 404 });
  }
  if (
    task.kind !== "writer" &&
    task.kind !== "outreach" &&
    task.kind !== "inbox" &&
    task.kind !== "concierge"
  ) {
    return NextResponse.json({ ok: false, error: "not an approvable task" }, { status: 400 });
  }
  if (task.status !== "needs_approval") {
    return NextResponse.json(
      { ok: false, error: `task status is ${task.status}, not needs_approval` },
      { status: 400 },
    );
  }
  // Concierge doesn't produce a draft — it's paused mid-run on a live browser
  // holding a button to click. Approval is just "flip status back to running"
  // and the in-process polling loop resumes the click. Skip the draft check.
  if (task.kind !== "concierge" && !task.result) {
    return NextResponse.json({ ok: false, error: "task has no draft" }, { status: 400 });
  }

  try {
    if (task.kind === "concierge") {
      const { error: upErr } = await admin
        .from("tasks")
        .update({ status: "running", error: null, needs_approval_at: null })
        .eq("id", taskId);
      if (upErr) {
        return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, action: "concierge_resumed" });
    }

    if (task.kind === "outreach") {
      return await approveOutreach(admin, auth.user.id, taskId, task.result as string);
    }

    if (task.kind === "inbox") {
      return await approveInbox(
        admin,
        auth.user.id,
        taskId,
        task.result as string,
        body.email_ids,
      );
    }

    const format = (task.args?.format as Format | undefined) ?? "general";
    const draft = task.result as string;
    if (format === "email" || format === "cold_outreach") {
      if (!body.to || !isEmail(body.to)) {
        return NextResponse.json(
          { ok: false, error: "recipient email required for email format" },
          { status: 400 },
        );
      }
      const email = await getEmailProvider(admin, auth.user.id);
      const { subject, bodyText } = splitSubjectBody(draft);
      const result = await email.createDraft({ to: body.to, subject, body: bodyText });

      await admin
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString(), needs_approval_at: null })
        .eq("id", taskId);

      return NextResponse.json({
        ok: true,
        action: "email_draft_created",
        provider: email.providerName,
        draft_id: result.id,
        open_url: result.open_url,
      });
    }

    if (format === "linkedin_post") {
      await admin
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString(), needs_approval_at: null })
        .eq("id", taskId);
      return NextResponse.json({
        ok: true,
        action: "open_compose",
        open_url: `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(draft)}`,
      });
    }

    if (format === "tweet") {
      await admin
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString(), needs_approval_at: null })
        .eq("id", taskId);
      return NextResponse.json({
        ok: true,
        action: "open_compose",
        open_url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(draft)}`,
      });
    }

    // whatsapp_reply, general
    await admin
      .from("tasks")
      .update({ status: "done", completed_at: new Date().toISOString(), needs_approval_at: null })
      .eq("id", taskId);
    return NextResponse.json({ ok: true, action: "copy", text: draft });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function splitSubjectBody(draft: string): { subject: string; bodyText: string } {
  const lines = draft.split(/\r?\n/);
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
  if (firstNonEmpty === -1) return { subject: "(no subject)", bodyText: "" };
  const subjectLine = (lines[firstNonEmpty] ?? "").replace(/^subject:\s*/i, "").trim();
  const rest = lines
    .slice(firstNonEmpty + 1)
    .join("\n")
    .replace(/^\s*\n/, "");
  return { subject: subjectLine || "(no subject)", bodyText: rest.trim() };
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function approveOutreach(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  resultJson: string,
): Promise<NextResponse> {
  let parsed: OutreachStored;
  try {
    parsed = JSON.parse(resultJson) as OutreachStored;
  } catch {
    return NextResponse.json({ ok: false, error: "outreach result is not valid JSON" }, { status: 500 });
  }

  let email: EmailProvider;
  try {
    email = await getEmailProvider(admin, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const results: Array<{ email: string; ok: boolean; draft_id?: string; error?: string }> = [];
  for (const d of parsed.drafts) {
    if (d.error || !d.subject || !d.body) {
      results.push({ email: d.prospect.email, ok: false, error: d.error ?? "missing subject/body" });
      continue;
    }
    try {
      const res = await email.createDraft({
        to: d.prospect.email,
        subject: d.subject,
        body: d.body,
      });
      results.push({ email: d.prospect.email, ok: true, draft_id: res.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ email: d.prospect.email, ok: false, error: msg });
    }
  }

  const createdCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - createdCount;

  await admin
    .from("tasks")
    .update({
      status: createdCount > 0 ? "done" : "failed",
      completed_at: new Date().toISOString(),
      needs_approval_at: null,
      error: failedCount > 0 ? `${failedCount} of ${results.length} drafts failed` : null,
    })
    .eq("id", taskId);

  return NextResponse.json({
    ok: true,
    action: "email_drafts_created",
    provider: email.providerName,
    created: createdCount,
    failed: failedCount,
    results,
  });
}

async function approveInbox(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  resultJson: string,
  emailIds: string[] | undefined,
): Promise<NextResponse> {
  let parsed: InboxStored;
  try {
    parsed = JSON.parse(resultJson) as InboxStored;
  } catch {
    return NextResponse.json({ ok: false, error: "inbox result is not valid JSON" }, { status: 500 });
  }

  // Filter to entries with a suggested_reply, then (if emailIds provided) to
  // the subset the user ticked. If emailIds is undefined, approve ALL entries
  // that have a draft.
  const candidates = parsed.entries.filter((e) => e.suggested_reply);
  const toDraft =
    emailIds && emailIds.length > 0
      ? candidates.filter((e) => emailIds.includes(e.email.id))
      : candidates;

  if (toDraft.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no replies selected or no drafts available" },
      { status: 400 },
    );
  }

  let email: EmailProvider;
  try {
    email = await getEmailProvider(admin, userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const results: Array<{
    email_id: string;
    ok: boolean;
    draft_id?: string;
    error?: string;
  }> = [];
  for (const entry of toDraft) {
    const reply = entry.suggested_reply;
    if (!reply) continue;
    try {
      const to = extractEmailAddress(entry.email.from);
      const res = await email.createReplyDraft({
        to,
        subject: reply.subject,
        body: reply.body,
        threadId: entry.email.thread_id,
        inReplyTo: entry.email.message_id_header,
      });
      results.push({ email_id: entry.email.id, ok: true, draft_id: res.id });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ email_id: entry.email.id, ok: false, error: msg });
    }
  }

  const createdCount = results.filter((r) => r.ok).length;
  const failedCount = results.length - createdCount;

  await admin
    .from("tasks")
    .update({
      status: createdCount > 0 ? "done" : "failed",
      completed_at: new Date().toISOString(),
      needs_approval_at: null,
      error: failedCount > 0 ? `${failedCount} of ${results.length} reply drafts failed` : null,
    })
    .eq("id", taskId);

  return NextResponse.json({
    ok: true,
    action: "email_reply_drafts_created",
    provider: email.providerName,
    created: createdCount,
    failed: failedCount,
    results,
  });
}

// Pulls the bare email address out of a From header like '"Alice" <alice@x.com>'.
function extractEmailAddress(fromHeader: string): string {
  const m = fromHeader.match(/<([^>]+)>/);
  if (m && m[1]) return m[1].trim();
  return fromHeader.trim();
}
