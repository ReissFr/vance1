// Brain-level commitments tools. Promises extracted from email — both what
// the user owes (outbound) and what's owed to them (inbound). Queue a scan
// to refresh, or mark a commitment as done.

import { z } from "zod";
import { defineTool } from "./types";

export const listMyCommitmentsTool = defineTool({
  name: "list_my_commitments",
  description: [
    "List the user's open commitments — promises extracted from email, in both",
    "directions. Returns commitment text, other party, deadline, and status.",
    "",
    "Use when the user asks: 'what did I promise?', 'what am I waiting on?',",
    "'who owes me something?', 'show my open loops', 'what's overdue?'.",
    "",
    "Status is auto-rolled: open commitments with a past deadline show as overdue.",
    "If the list looks stale, call scan_my_commitments to sweep fresh email.",
  ].join("\n"),
  schema: z.object({
    direction: z.enum(["outbound", "inbound", "all"]).optional(),
    status: z.enum(["open", "done", "overdue", "cancelled", "all"]).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["outbound", "inbound", "all"],
        description: "outbound = user owes. inbound = owed to user. Default all.",
      },
      status: {
        type: "string",
        enum: ["open", "done", "overdue", "cancelled", "all"],
        description: "Default 'open' (includes overdue).",
      },
      limit: { type: "number", description: "Max rows. Default 200, max 500." },
    },
  },
  async run(input, ctx) {
    const limit = input.limit ?? 200;
    const direction = input.direction ?? "all";
    const status = input.status ?? "open";

    let q = ctx.supabase
      .from("commitments")
      .select(
        "id, direction, other_party, commitment_text, deadline, status, source_email_subject, confidence",
      )
      .eq("user_id", ctx.userId)
      .order("deadline", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (direction !== "all") q = q.eq("direction", direction);
    if (status !== "all") q = q.eq("status", status);

    const { data, error } = await q;
    if (error) throw new Error(`Failed to load commitments: ${error.message}`);

    const nowIso = new Date().toISOString();
    const rows = (data ?? []).map((r) => {
      if (r.status === "open" && r.deadline && (r.deadline as string) < nowIso) {
        return { ...r, status: "overdue" };
      }
      return r;
    });

    const byDirection = { outbound: 0, inbound: 0 };
    const overdueCount = rows.filter((r) => r.status === "overdue").length;
    for (const r of rows) {
      if (r.direction === "outbound") byDirection.outbound += 1;
      else if (r.direction === "inbound") byDirection.inbound += 1;
    }

    return {
      count: rows.length,
      by_direction: byDirection,
      overdue_count: overdueCount,
      commitments: rows,
    };
  },
});

export const scanMyCommitmentsTool = defineTool({
  name: "scan_my_commitments",
  description: [
    "Queue a fresh sweep of the user's email for commitments in both directions.",
    "Scans the last 14 days of sent + received, extracts promises with deadlines,",
    "populates the commitments table. Idempotent — same promise won't duplicate.",
    "",
    "Runs server-side in the background. Respond with a short ack.",
    "",
    "Use when the user asks: 'find my open loops', 'what am I forgetting?',",
    "'sweep my promises' AND the existing list looks stale.",
  ].join("\n"),
  schema: z.object({
    title: z.string().min(1).max(120).optional(),
    query: z.string().max(400).optional(),
    max: z.number().int().min(10).max(100).optional(),
    notify: z.boolean().optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short label for the Tasks panel." },
      query: { type: "string", description: "Override Gmail query. Default last 14d inbox+sent." },
      max: { type: "number", description: "Cap on emails. Default 40, max 100." },
      notify: { type: "boolean", description: "WhatsApp ping when done. Default false." },
    },
  },
  async run(input, ctx) {
    const title = input.title ?? "Commitments scan";
    const notify = input.notify ?? false;
    const { data, error } = await ctx.supabase
      .from("tasks")
      .insert({
        user_id: ctx.userId,
        kind: "commitments_scan",
        prompt: "Scan email for open commitments",
        args: { title, query: input.query, max: input.max, notify },
        device_target: "server",
        status: "queued",
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to enqueue commitments scan: ${error.message}`);

    const baseUrl =
      process.env.JARVIS_INTERNAL_BASE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.TWILIO_PUBLIC_BASE_URL ||
      "http://localhost:3030";

    void fetch(`${baseUrl}/api/tasks/run-commitments-scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: data.id }),
    }).catch((e) => console.warn("[scan_my_commitments] trigger failed:", e));

    return {
      task_id: data.id,
      status: "queued",
      title,
      message: "Commitments scan queued. Tell the user it's running.",
    };
  },
});

export const lookupContactTool = defineTool({
  name: "lookup_contact",
  description: [
    "Pull the chief-of-staff briefing on a specific counterparty by email:",
    "open + recently-closed commitments, the last meetings they attended,",
    "the most recent recall events mentioning them, and a simple reliability",
    "score (promises delivered / promises lapsed).",
    "",
    "Use when the user asks: 'what's the latest with ana@acme.co?',",
    "'how reliable is Bob on follow-through?', 'where are we with",
    "contact@vendor.com?'. Ideal before replying to a tricky email or",
    "walking into a call.",
    "",
    "If the user refers to a person by name only, ask for the email (or",
    "infer from recent emails) before calling — this tool matches by email.",
  ].join("\n"),
  schema: z.object({
    email: z.string().email().describe("Counterparty's email address."),
    max_meetings: z.number().int().min(1).max(20).optional(),
    max_recall: z.number().int().min(1).max(20).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      email: { type: "string", description: "Counterparty's email address." },
      max_meetings: {
        type: "number",
        description: "Max meetings to return. Default 8, max 20.",
      },
      max_recall: {
        type: "number",
        description: "Max recall events to return. Default 8, max 20.",
      },
    },
    required: ["email"],
  },
  async run(input, ctx) {
    const email = input.email.trim().toLowerCase();
    const maxMeetings = input.max_meetings ?? 8;
    const maxRecall = input.max_recall ?? 8;

    const [commitmentsRes, meetingsRes, recallRes] = await Promise.all([
      ctx.supabase
        .from("commitments")
        .select(
          "id, direction, other_party, commitment_text, deadline, status, created_at, updated_at",
        )
        .eq("user_id", ctx.userId)
        .eq("other_party_email", email)
        .order("created_at", { ascending: false })
        .limit(50),
      ctx.supabase
        .from("meeting_sessions")
        .select("id, title, started_at, summary")
        .eq("user_id", ctx.userId)
        .contains("participants", [email])
        .order("started_at", { ascending: false })
        .limit(maxMeetings),
      ctx.supabase
        .from("recall_events")
        .select("id, source, title, body, occurred_at")
        .eq("user_id", ctx.userId)
        .contains("participants", [email])
        .order("occurred_at", { ascending: false })
        .limit(maxRecall),
    ]);

    const commitments = (commitmentsRes.data ?? []) as Array<{
      id: string;
      direction: "outbound" | "inbound";
      other_party: string;
      commitment_text: string;
      deadline: string | null;
      status: string;
      created_at: string;
      updated_at: string;
    }>;

    const open = commitments.filter((c) => c.status === "open");
    const closed = commitments.filter((c) => c.status === "done");
    const name = commitments.find((c) => c.other_party?.trim())?.other_party ?? null;

    // Reliability: delivered = status=done, lapsed = open-but-deadline->14d-past.
    const now = Date.now();
    const countReliability = (dir: "outbound" | "inbound") => {
      let delivered = 0;
      let lapsed = 0;
      for (const c of commitments) {
        if (c.direction !== dir) continue;
        if (c.status === "done") {
          delivered += 1;
        } else if (c.status === "open" && c.deadline) {
          const ageMs = now - new Date(c.deadline).getTime();
          if (ageMs > 14 * 24 * 60 * 60 * 1000) lapsed += 1;
        }
      }
      const total = delivered + lapsed;
      const ratio = total >= 2 ? Number((delivered / total).toFixed(2)) : null;
      return { delivered, lapsed, ratio };
    };

    return {
      email,
      name,
      commitments: {
        open_count: open.length,
        closed_count: closed.length,
        open,
        closed_recent: closed.slice(0, 10),
      },
      meetings: (meetingsRes.data ?? []).map((m) => ({
        id: m.id,
        title: m.title,
        started_at: m.started_at,
        summary: m.summary ? String(m.summary).slice(0, 400) : null,
      })),
      recall: (recallRes.data ?? []).map((r) => ({
        id: r.id,
        source: r.source,
        title: r.title,
        snippet: String(r.body ?? "").slice(0, 240),
        occurred_at: r.occurred_at,
      })),
      reliability: {
        they_deliver_to_me: countReliability("inbound"),
        i_deliver_to_them: countReliability("outbound"),
      },
    };
  },
});

export const markCommitmentDoneTool = defineTool({
  name: "mark_commitment_done",
  description: [
    "Mark a commitment as done (or cancelled) when the user confirms it's",
    "handled. Match by fuzzy search on commitment_text and other_party.",
    "",
    "Use when the user says: 'I sent the proposal to Ana', 'tell JARVIS I did X',",
    "'cancel the commitment about Y'.",
  ].join("\n"),
  schema: z.object({
    commitment_text_match: z
      .string()
      .min(2)
      .describe("Substring match (case-insensitive) against commitment_text."),
    other_party_match: z.string().optional(),
    status: z.enum(["done", "cancelled"]).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      commitment_text_match: {
        type: "string",
        description: "Substring to match in commitment_text.",
      },
      other_party_match: {
        type: "string",
        description: "Optional substring to narrow by other_party.",
      },
      status: {
        type: "string",
        enum: ["done", "cancelled"],
        description: "Default 'done'.",
      },
    },
    required: ["commitment_text_match"],
  },
  async run(input, ctx) {
    const nextStatus = input.status ?? "done";
    let q = ctx.supabase
      .from("commitments")
      .select("id, commitment_text, other_party, direction")
      .eq("user_id", ctx.userId)
      .in("status", ["open", "overdue"])
      .ilike("commitment_text", `%${input.commitment_text_match}%`);
    if (input.other_party_match) {
      q = q.ilike("other_party", `%${input.other_party_match}%`);
    }
    const { data: matches, error } = await q;
    if (error) throw new Error(`Failed to lookup: ${error.message}`);
    if (!matches || matches.length === 0) {
      return {
        ok: false,
        message: `No open commitment matches "${input.commitment_text_match}".`,
      };
    }

    const ids = matches.map((m) => m.id as string);
    const { error: updErr } = await ctx.supabase
      .from("commitments")
      .update({
        status: nextStatus,
        user_confirmed: true,
        updated_at: new Date().toISOString(),
      })
      .in("id", ids);
    if (updErr) throw new Error(`Failed to update: ${updErr.message}`);

    return {
      ok: true,
      count: matches.length,
      status: nextStatus,
      matched: matches.map((m) => ({
        text: m.commitment_text,
        other_party: m.other_party,
        direction: m.direction,
      })),
    };
  },
});
