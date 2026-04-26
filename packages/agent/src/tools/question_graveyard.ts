// Brain tools for the QUESTION GRAVEYARD — questions the user asked themselves
// and never answered. Different from conversation loops (recurring questions);
// graveyard catches questions that may have been asked once but were never
// closed. Six kinds: decision / self_inquiry / meta / factual / hypothetical /
// rhetorical. Phase 2 detects "answer markers" near topic terms in subsequent
// messages — if none, the question lives in the graveyard with a neglect_score.

import { z } from "zod";
import { defineTool } from "./types";

type ProposedAnswer = { date: string; snippet: string };

type Question = {
  id: string;
  scan_id: string;
  question_text: string;
  question_kind: string;
  needs_answer: boolean;
  domain: string;
  asked_date: string;
  asked_message_id: string | null;
  asked_conversation_id: string | null;
  topic_aliases: string[];
  days_since_asked: number;
  asked_again_count: number;
  asked_again_days: number;
  answered: boolean;
  answer_text: string | null;
  answer_date: string | null;
  answer_message_id: string | null;
  days_to_answer: number | null;
  proposed_answer_excerpts: ProposedAnswer[];
  neglect_score: number;
  confidence: number;
  status: string;
  status_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  latency_ms: number | null;
  model: string | null;
  created_at: string;
};

type Stats = {
  total: number;
  pending: number;
  acknowledged: number;
  answered: number;
  contested: number;
  dismissed: number;
  unanswered: number;
  severely_neglected: number;
  strongly_neglected: number;
  kind_counts: Record<string, number>;
  domain_counts: Record<string, number>;
};

export const scanQuestionGraveyardTool = defineTool({
  name: "scan_question_graveyard",
  description: [
    "Run a QUESTION GRAVEYARD SCAN — mine the user's own messages for",
    "self-directed QUESTIONS they asked themselves but never answered.",
    "Six kinds:",
    "  decision      — 'should I keep the agency or close it'",
    "  self_inquiry  — 'why do I keep doing this', 'am I really a builder'",
    "  meta          — 'what's the right way to think about this'",
    "  factual       — 'how much runway do I have'",
    "  hypothetical  — 'what if I had said yes back then'",
    "  rhetorical    — flagged but excluded from neglect tracking",
    "",
    "After extraction the server walks subsequent messages for each",
    "question. Two signals:",
    "  - 'answer markers' near topic_aliases ('I've decided X', 'I'll Y',",
    "    'going with Z', 'on reflection') -> records up to 3 proposed",
    "    answer excerpts; first match becomes the canonical answer.",
    "  - re-asks of the same question (topic + question mark + self-",
    "    directed phrasing) -> asked_again_count.",
    "",
    "Each row gets a neglect_score:",
    "  5 = >=90 days unanswered + decision/self_inquiry/meta",
    "      OR >=120 days unanswered any kind",
    "  4 = >=60 days unanswered AND important kind, OR >=90 days any",
    "  3 = >=30 days unanswered",
    "  2 = >=14 days unanswered",
    "  1 = <14 days OR already answered OR rhetorical",
    "",
    "Use when the user asks 'what questions have I been avoiding',",
    "'what am I not answering myself', 'what's hanging over me',",
    "'questions I've been asking into the void'. Different from the",
    "Conversation Loops (recurring questions) — graveyard catches",
    "questions that may have been asked ONCE and never closed.",
    "",
    "Optional: window_days (30-365, default 180). Costs an LLM call",
    "plus a substring scan (10-25s).",
    "",
    "The brain should run this when the user is feeling stuck, when",
    "they ask 'what am I avoiding', or when surfacing a severely-",
    "neglected decision could unblock them.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(365).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/question-graveyard/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input ?? {}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      questions?: Question[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      questions: (j.questions ?? []).map((q) => ({
        id: q.id,
        question_text: q.question_text,
        question_kind: q.question_kind,
        domain: q.domain,
        asked_date: q.asked_date,
        days_since_asked: q.days_since_asked,
        asked_again_count: q.asked_again_count,
        answered: q.answered,
        days_to_answer: q.days_to_answer,
        neglect_score: q.neglect_score,
        confidence: q.confidence,
      })),
    };
  },
});

export const listQuestionGraveyardTool = defineTool({
  name: "list_question_graveyard",
  description: [
    "List buried questions plus stats. Optional filters:",
    "  status   (pending | acknowledged | answered | contested |",
    "            dismissed | pinned | archived | all, default pending)",
    "  answered (any | true | false, default any)",
    "  kind     (decision | self_inquiry | meta | factual |",
    "            hypothetical | rhetorical | all, default all)",
    "  domain   (work | relationships | health | identity | finance |",
    "            creative | learning | daily | other | all, default all)",
    "  min_neglect    (1-5, default 1)",
    "  min_confidence (1-5, default 2)",
    "  limit          (default 30, max 100)",
    "",
    "Returns rows + stats including unanswered, severely_neglected (>=5),",
    "strongly_neglected (>=4), per-kind and per-domain counts.",
    "",
    "Use cases:",
    "  - User asks 'what am I avoiding answering?' -> filter answered=false,",
    "    min_neglect=4 to surface the severely neglected questions.",
    "  - User asks 'what big decisions am I sitting on?' -> kind=decision,",
    "    answered=false, sorted by neglect_score desc.",
    "  - User asks 'what have I actually answered?' -> filter answered=true.",
    "",
    "Each question returns: question_text (verbatim with the '?'), kind,",
    "domain, asked_date, days_since_asked, asked_again_count (re-asks),",
    "answered + answer_text/date if Phase 2 detected one, proposed_answer",
    "excerpts (other candidate answers found near the topic), neglect_score.",
    "",
    "The brain should surface the literal question — quote it back at the",
    "user verbatim. The point is to put the question in front of them",
    "again, not paraphrase it.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["pending", "acknowledged", "answered", "contested", "dismissed", "pinned", "archived", "all"]).optional().default("pending"),
    answered: z.enum(["any", "true", "false"]).optional().default("any"),
    kind: z.enum(["decision", "self_inquiry", "meta", "factual", "hypothetical", "rhetorical", "all"]).optional().default("all"),
    domain: z.enum(["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"]).optional().default("all"),
    min_neglect: z.number().int().min(1).max(5).optional().default(1),
    min_confidence: z.number().int().min(1).max(5).optional().default(2),
    limit: z.number().int().min(1).max(100).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["pending", "acknowledged", "answered", "contested", "dismissed", "pinned", "archived", "all"] },
      answered: { type: "string", enum: ["any", "true", "false"] },
      kind: { type: "string", enum: ["decision", "self_inquiry", "meta", "factual", "hypothetical", "rhetorical", "all"] },
      domain: { type: "string", enum: ["work", "relationships", "health", "identity", "finance", "creative", "learning", "daily", "other", "all"] },
      min_neglect: { type: "number" },
      min_confidence: { type: "number" },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const params = new URLSearchParams();
    params.set("status", input.status ?? "pending");
    params.set("answered", input.answered ?? "any");
    params.set("kind", input.kind ?? "all");
    params.set("domain", input.domain ?? "all");
    params.set("min_neglect", String(Math.max(1, Math.min(5, input.min_neglect ?? 1))));
    params.set("min_confidence", String(Math.max(1, Math.min(5, input.min_confidence ?? 2))));
    params.set("limit", String(Math.max(1, Math.min(100, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/question-graveyard?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { questions?: Question[]; stats?: Stats };
    const rows = j.questions ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      questions: rows.map((q) => ({
        id: q.id,
        question_text: q.question_text,
        question_kind: q.question_kind,
        needs_answer: q.needs_answer,
        domain: q.domain,
        asked_date: q.asked_date,
        days_since_asked: q.days_since_asked,
        asked_again_count: q.asked_again_count,
        answered: q.answered,
        answer_text: q.answer_text,
        answer_date: q.answer_date,
        days_to_answer: q.days_to_answer,
        proposed_answer_excerpts: (q.proposed_answer_excerpts ?? []).slice(0, 3),
        neglect_score: q.neglect_score,
        confidence: q.confidence,
        status: q.status,
        status_note: q.status_note,
        pinned: q.pinned,
      })),
    };
  },
});

export const respondToQuestionTool = defineTool({
  name: "respond_to_question",
  description: [
    "Resolve or annotate a buried question. Specify exactly one mode:",
    "",
    "  answer       — user is providing their answer NOW. status_note",
    "                 SHOULD contain the actual answer (will be saved as",
    "                 answer_text). This locks the question to answered.",
    "  acknowledged — user acknowledges the question is still open but",
    "                 wants to think about it later (no answer yet).",
    "  contested    — user disagrees this was a real self-question",
    "                 (false positive). status_note explains why.",
    "  dismissed    — junk extraction / not relevant.",
    "  pin / unpin       — keep visible.",
    "  archive / restore — hide / unhide.",
    "",
    "Use 'answer' when the user gives a substantive reply to one of",
    "their own questions in the conversation — capture their answer",
    "and store it. Don't fabricate answers on the user's behalf.",
  ].join("\n"),
  schema: z.object({
    id: z.string().uuid(),
    mode: z.enum(["answer", "acknowledged", "contested", "dismissed", "pin", "unpin", "archive", "restore"]),
    status_note: z.string().min(1).max(2000).optional(),
  }),
  inputSchema: {
    type: "object",
    required: ["id", "mode"],
    properties: {
      id: { type: "string" },
      mode: { type: "string", enum: ["answer", "acknowledged", "contested", "dismissed", "pin", "unpin", "archive", "restore"] },
      status_note: { type: "string" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const payload: Record<string, unknown> = {};
    if (input.mode === "answer") {
      if (!input.status_note || input.status_note.trim().length === 0) {
        return { ok: false, error: "answer mode requires status_note (the user's actual answer)" };
      }
      payload.status = "answered";
      payload.status_note = input.status_note;
    } else if (["acknowledged", "contested", "dismissed"].includes(input.mode)) {
      payload.status = input.mode;
      if (input.status_note) payload.status_note = input.status_note;
    } else if (input.mode === "pin") payload.pin = true;
    else if (input.mode === "unpin") payload.pin = false;
    else if (input.mode === "archive") payload.archive = true;
    else if (input.mode === "restore") payload.restore = true;

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/question-graveyard/${encodeURIComponent(input.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { question?: Question };
    if (!j.question) return { ok: false, error: "no row returned" };
    const q = j.question;
    return {
      ok: true,
      question: {
        id: q.id,
        question_text: q.question_text,
        question_kind: q.question_kind,
        domain: q.domain,
        answered: q.answered,
        answer_text: q.answer_text,
        answer_date: q.answer_date,
        status: q.status,
        status_note: q.status_note,
        pinned: q.pinned,
        archived: q.archived_at != null,
      },
    };
  },
});
