// POST /api/contacts/nudge { commitment_id }
//
// Drafts a polite reminder email for an overdue inbound commitment (something
// the other party promised the user and hasn't delivered). Uses Haiku to
// generate the body in the user's voice, then hands off to the EmailProvider
// to create a draft in Gmail/Outlook/etc. Appends an audit line to the
// commitment's notes.

import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { getEmailProvider } from "@jarvis/integrations";

export const runtime = "nodejs";

const MODEL = "claude-haiku-4-5-20251001";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const commitmentId = typeof body.commitment_id === "string" ? body.commitment_id : null;
  if (!commitmentId) {
    return NextResponse.json({ error: "commitment_id required" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: c, error: loadErr } = await admin
    .from("commitments")
    .select(
      "id, user_id, direction, other_party, other_party_email, commitment_text, deadline, status, source_email_subject, source_kind, notes",
    )
    .eq("id", commitmentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (loadErr || !c) {
    return NextResponse.json({ error: "commitment not found" }, { status: 404 });
  }
  if (c.direction !== "inbound") {
    return NextResponse.json(
      { error: "nudges only make sense for inbound (they-owe-you) commitments" },
      { status: 400 },
    );
  }
  if (!c.other_party_email) {
    return NextResponse.json(
      { error: "no email on file for this contact — can't draft a nudge" },
      { status: 400 },
    );
  }
  if (c.status === "done" || c.status === "cancelled") {
    return NextResponse.json(
      { error: `commitment is already ${c.status}` },
      { status: 400 },
    );
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();
  const senderName = profile?.display_name ?? "me";

  const deadlineText = c.deadline
    ? new Date(c.deadline as string).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;
  const daysPast =
    c.deadline
      ? Math.floor(
          (Date.now() - new Date(c.deadline as string).getTime()) /
            (24 * 60 * 60 * 1000),
        )
      : null;

  const systemPrompt = [
    `You are ${senderName}'s writing assistant. Draft a short, warm nudge email`,
    "for a promise the recipient made that they haven't delivered yet.",
    "",
    "Rules:",
    "- Keep it under 80 words. Friendly, not passive-aggressive.",
    "- Don't apologize for following up. Don't say 'just checking in'.",
    "- Reference the specific thing they said they'd do.",
    "- If there was a deadline and it's past, acknowledge it lightly.",
    "- End with a soft ask ('any update?' / 'still good on your end?').",
    "- No signature — the provider handles that.",
    "- Reply with JSON only: {\"subject\":\"...\",\"body\":\"...\"}.",
    "  Body uses \\n for line breaks. No greeting formality like 'Dear'.",
  ].join("\n");

  const userMsg = [
    `Recipient: ${c.other_party}${c.other_party_email ? ` <${c.other_party_email}>` : ""}`,
    `They promised: "${c.commitment_text}"`,
    deadlineText ? `Deadline: ${deadlineText}` : "Deadline: (none specified)",
    daysPast != null && daysPast > 0
      ? `Days past deadline: ${daysPast}`
      : "",
    c.source_email_subject
      ? `Original email subject: "${c.source_email_subject}"`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  let draft: { subject: string; body: string } | null = null;
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    });
    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
      .replace(/^```json\n?|\n?```$/g, "");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (
      typeof parsed.subject === "string" &&
      typeof parsed.body === "string" &&
      parsed.subject.trim() &&
      parsed.body.trim()
    ) {
      draft = { subject: parsed.subject.trim(), body: parsed.body.trim() };
    }
  } catch {
    // fall through to error below
  }
  if (!draft) {
    return NextResponse.json(
      { error: "failed to generate nudge draft" },
      { status: 502 },
    );
  }

  // Gmail-style threading via "Re:" on the original subject, when we have it.
  const subject = c.source_email_subject
    ? c.source_email_subject.toLowerCase().startsWith("re:")
      ? c.source_email_subject
      : `Re: ${c.source_email_subject}`
    : draft.subject;

  let provider;
  try {
    provider = await getEmailProvider(admin, user.id);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "no email provider configured",
      },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await provider.createDraft({
      to: c.other_party_email as string,
      subject,
      body: draft.body,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "draft creation failed" },
      { status: 502 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const trail = `[nudged ${today}] drafted reminder${deadlineText ? ` (deadline ${deadlineText})` : ""}`;
  const merged = c.notes ? `${c.notes}\n${trail}` : trail;
  await admin
    .from("commitments")
    .update({ notes: merged, updated_at: new Date().toISOString() })
    .eq("id", c.id as string)
    .eq("user_id", user.id);

  return NextResponse.json({
    draft_id: result.id,
    open_url: result.open_url,
    subject,
    body: draft.body,
  });
}
