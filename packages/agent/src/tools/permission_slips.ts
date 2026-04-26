// Brain tools for THE PERMISSION-SLIPS LEDGER (§177) — every "I can't" /
// "I'm not allowed to" / "I shouldn't be" / "it's not for me" / "I'm not
// the kind of person who" the user voices about themselves. The constraints
// they place NEGATIVELY on themselves.
//
// Distinct from §168 shoulds (felt obligations TO DO X — those demand
// action; permission-slips REFUSE action) and from §172 vows (positive
// self-authored rules — "I always" / "I never"; permission-slips are not
// principles but BLOCKS).
//
// THE NOVEL HOOK is THE SIGNER. Every refusal has an implicit authority
// who would have to grant permission. Most permission-slips have an
// EXTERNAL signer the user hasn't noticed they're answering to: parent,
// partner, peers, society, employer, profession, circumstance. Surfacing
// the signer is half the move toward re-authorship.
//
// Four resolutions, refusing the binary of "obey / ignore":
//   sign_self  — the user signs their own permission slip. THE NOVEL
//                resolution. Refuses the assumption that someone else needs
//                to grant.
//   re_sign    — the constraint is legitimate; accepted with eyes open.
//                The signer is named and the reason is acknowledged.
//   refuse     — the slip isn't real / the authority is illegitimate.
//   dismiss    — false-positive scan.

import { z } from "zod";
import { defineTool } from "./types";

type PermissionSlip = {
  id: string;
  scan_id: string | null;
  forbidden_action: string;
  signer: string;
  authority_text: string | null;
  domain: string;
  charge: number;
  recency: string;
  confidence: number;
  spoken_date: string;
  spoken_message_id: string;
  conversation_id: string | null;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  pinned: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type Stats = {
  total: number;
  open: number;
  signed_by_self: number;
  re_signed: number;
  refused: number;
  dismissed: number;
  pinned: number;
  load_bearing_open: number;
  open_unsigned: number;
  open_external_signer: number;
  open_self_signed: number;
  signer_counts: Record<string, number>;
  open_signer_counts: Record<string, number>;
  domain_counts: Record<string, number>;
  biggest_open: null | { id: string; forbidden_action: string; charge: number; signer: string };
  most_common_signer: null | { signer: string; count: number };
  most_common_open_signer: null | { signer: string; count: number };
};

export const scanPermissionSlipsTool = defineTool({
  name: "scan_permission_slips",
  description: [
    "Mine the user's chat for PERMISSION-SLIPS — every 'I can't' / 'I'm",
    "not allowed to' / 'I shouldn't be' / 'it's not for me' / 'I'm not the",
    "kind of person who' they voice about themselves. The constraints they",
    "place NEGATIVELY on themselves.",
    "",
    "For each captures: forbidden_action (what they're refusing themselves),",
    "SIGNER (the novel diagnostic — who would have to grant permission:",
    "self / parent / partner / peers / society / employer / profession /",
    "circumstance / unknown), authority_text (specific naming if available),",
    "domain, charge 1-5, recency, confidence, msg_id.",
    "",
    "Costs an LLM call (15-30s). Default window 180 days. Min 30 days.",
    "Won't insert duplicates of slips already in the ledger (UPSERT-by",
    "forbidden_action+signer).",
    "",
    "Use when the user asks 'what am I refusing myself', 'where am I",
    "blocked', 'what do I keep saying I can't do', 'who's holding the pen',",
    "'where am I living by someone else's rules'. Quote forbidden_action",
    "verbatim AND name the SIGNER when reporting — surfacing that there's",
    "an external authority is half the diagnostic value.",
  ].join("\n"),
  schema: z.object({
    window_days: z.number().int().min(30).max(540).optional().default(180),
  }),
  inputSchema: {
    type: "object",
    properties: {
      window_days: { type: "number", description: "Window in days (30-540, default 180)" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/permission-slips/scan`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({ window_days: input.window_days ?? 180 }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `permission-slips scan failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as {
      scan_id?: string;
      inserted?: number;
      latency_ms?: number;
      message?: string;
      permission_slips?: PermissionSlip[];
      signals?: Record<string, number>;
    };
    return {
      ok: true,
      scan_id: j.scan_id,
      inserted: j.inserted ?? 0,
      message: j.message,
      latency_ms: j.latency_ms,
      signals: j.signals,
      permission_slips: (j.permission_slips ?? []).map((p) => ({
        id: p.id,
        forbidden_action: p.forbidden_action,
        signer: p.signer,
        authority_text: p.authority_text,
        domain: p.domain,
        charge: p.charge,
        recency: p.recency,
        confidence: p.confidence,
        spoken_date: p.spoken_date,
      })),
    };
  },
});

export const listPermissionSlipsTool = defineTool({
  name: "list_permission_slips",
  description: [
    "List permission-slips in the user's ledger plus stats. Filters:",
    "  status         (open | signed_by_self | re_signed | refused |",
    "                  dismissed | pinned | archived | all, default open)",
    "  signer         (self | parent | partner | peers | society | employer",
    "                  | profession | circumstance | unknown | all)",
    "  domain         (work | health | relationships | family | finance |",
    "                  creative | self | spiritual | other | all)",
    "  min_charge     (1-5, default 1)",
    "  pinned         (true to filter pinned only)",
    "  limit          (default 30, max 200)",
    "",
    "Returns slips + stats including load_bearing_open (charge=5 open —",
    "identity-level self-restrictions), open_external_signer (THE diagnostic:",
    "open slips where someone else is holding the pen), open_self_signed,",
    "open_signer_counts (who's signing the most open slips — surfaces the",
    "implicit authority), most_common_open_signer.",
    "",
    "Use when the user asks 'what am I refusing myself', 'where am I",
    "blocked', 'what's keeping me small', 'who am I answering to'. ALWAYS",
    "name the SIGNER when reporting — that's the novel hook. The diagnostic",
    "value is in seeing that most open slips have an external signer the",
    "user hasn't noticed.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["open", "signed_by_self", "re_signed", "refused", "dismissed", "pinned", "archived", "all"]).optional().default("open"),
    signer: z.enum(["self", "parent", "partner", "peers", "society", "employer", "profession", "circumstance", "unknown", "all"]).optional().default("all"),
    domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"]).optional().default("all"),
    min_charge: z.number().int().min(1).max(5).optional().default(1),
    pinned: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(200).optional().default(30),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["open", "signed_by_self", "re_signed", "refused", "dismissed", "pinned", "archived", "all"] },
      signer: { type: "string", enum: ["self", "parent", "partner", "peers", "society", "employer", "profession", "circumstance", "unknown", "all"] },
      domain: { type: "string", enum: ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other", "all"] },
      min_charge: { type: "number" },
      pinned: { type: "boolean" },
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
    const status = input.status ?? "open";
    if (status !== "all") params.set("status", status);
    if (input.signer && input.signer !== "all") params.set("signer", input.signer);
    if (input.domain && input.domain !== "all") params.set("domain", input.domain);
    if (input.min_charge && input.min_charge > 1) params.set("min_charge", String(input.min_charge));
    if (input.pinned) params.set("status", "pinned");
    params.set("limit", String(Math.max(1, Math.min(200, input.limit ?? 30))));

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/permission-slips?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: sessionToken },
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `list failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { permission_slips?: PermissionSlip[]; stats?: Stats };
    const rows = j.permission_slips ?? [];
    return {
      ok: true,
      count: rows.length,
      stats: j.stats,
      permission_slips: rows.map((p) => ({
        id: p.id,
        forbidden_action: p.forbidden_action,
        signer: p.signer,
        authority_text: p.authority_text,
        domain: p.domain,
        charge: p.charge,
        confidence: p.confidence,
        spoken_date: p.spoken_date,
        status: p.status,
        resolution_note: p.resolution_note,
        pinned: p.pinned,
      })),
    };
  },
});

export const respondToPermissionSlipTool = defineTool({
  name: "respond_to_permission_slip",
  description: [
    "Resolve, edit, or annotate a permission-slip. Specify exactly one mode:",
    "",
    "  sign_self — THE NOVEL RESOLUTION. The user signs their own",
    "              permission slip. Refuses the assumption that someone else",
    "              needs to grant. resolution_note IS the permission the",
    "              user is granting themselves (REQUIRED — server rejects",
    "              empty). Use when the user has decided the slip is theirs",
    "              to sign. Examples:",
    "                'take a sabbatical this year' (signer: profession) ->",
    "                sign_self with note 'I am giving myself permission to",
    "                take three months off without it meaning I'm dropping",
    "                out of the field.'",
    "",
    "  re_sign   — the constraint is legitimate; accepted with eyes open.",
    "              The signer is named and the reason is acknowledged.",
    "              resolution_note IS the legitimate reason (REQUIRED). Use",
    "              when the slip turns out to be a real constraint the user",
    "              chooses to keep. Examples:",
    "                'spend on myself' (signer: circumstance) -> re_sign",
    "                with note 'mortgage and the kids' school. Real. I'll",
    "                revisit when the youngest is 16.'",
    "",
    "  refuse    — the slip isn't real / the authority is illegitimate.",
    "              resolution_note IS why the slip is rejected (REQUIRED).",
    "              Use when the user has named the signer and decided to",
    "              stop answering to them. Examples:",
    "                'be the loud person in the room' (signer: family) ->",
    "                refuse with note 'that was my mum's rule, not mine.",
    "                I'm done with it.'",
    "",
    "  dismiss   — false positive from the scan (not a real refusal).",
    "  unresolve — return to open.",
    "  pin / unpin — toggle pinned.",
    "  archive / restore — soft hide / un-hide.",
    "  edit      — fix mis-extracted forbidden_action / signer /",
    "              authority_text / domain / charge. ≥1 required.",
    "",
    "Use ONLY after the user has stated a clear stance. NEVER silently",
    "default — make the user pick between sign_self / re_sign / refuse /",
    "dismiss. The four resolutions hold open four different futures for",
    "the slip. SIGN_SELF is the most novel: it converts 'I can't' into",
    "'I am giving myself permission to'.",
  ].join("\n"),
  schema: z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("sign_self"),
      permission_slip_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (the permission you are granting yourself) is required for sign_self").max(1500),
    }),
    z.object({
      mode: z.literal("re_sign"),
      permission_slip_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (the legitimate reason this constraint holds) is required for re_sign").max(1500),
    }),
    z.object({
      mode: z.literal("refuse"),
      permission_slip_id: z.string().uuid(),
      resolution_note: z.string().min(4, "resolution_note (why this slip isn't real / why the authority is illegitimate) is required for refuse").max(1500),
    }),
    z.object({
      mode: z.literal("dismiss"),
      permission_slip_id: z.string().uuid(),
      resolution_note: z.string().max(1500).optional(),
    }),
    z.object({
      mode: z.literal("unresolve"),
      permission_slip_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("pin"),
      permission_slip_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("unpin"),
      permission_slip_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("archive"),
      permission_slip_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("restore"),
      permission_slip_id: z.string().uuid(),
    }),
    z.object({
      mode: z.literal("edit"),
      permission_slip_id: z.string().uuid(),
      forbidden_action: z.string().min(4).max(280).optional(),
      signer: z.enum(["self", "parent", "partner", "peers", "society", "employer", "profession", "circumstance", "unknown"]).optional(),
      authority_text: z.string().max(160).optional(),
      domain: z.enum(["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"]).optional(),
      charge: z.number().int().min(1).max(5).optional(),
    }),
  ]),
  inputSchema: {
    type: "object",
    required: ["mode", "permission_slip_id"],
    properties: {
      mode: { type: "string", enum: ["sign_self", "re_sign", "refuse", "dismiss", "unresolve", "pin", "unpin", "archive", "restore", "edit"] },
      permission_slip_id: { type: "string" },
      resolution_note: { type: "string", description: "REQUIRED for sign_self (the permission you are granting yourself), re_sign (the legitimate reason this constraint holds), refuse (why this slip isn't real); optional for dismiss." },
      forbidden_action: { type: "string", description: "Optional for edit (4-280 chars)." },
      signer: { type: "string", enum: ["self", "parent", "partner", "peers", "society", "employer", "profession", "circumstance", "unknown"], description: "Optional for edit." },
      authority_text: { type: "string", description: "Optional for edit (≤160 chars; pass empty to clear)." },
      domain: { type: "string", enum: ["work", "health", "relationships", "family", "finance", "creative", "self", "spiritual", "other"], description: "Optional for edit." },
      charge: { type: "number", description: "Optional for edit (1-5)." },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const body: Record<string, unknown> = { mode: input.mode };
    if (input.mode === "sign_self" || input.mode === "re_sign" || input.mode === "refuse") {
      body.resolution_note = input.resolution_note;
    } else if (input.mode === "dismiss") {
      if (input.resolution_note) body.resolution_note = input.resolution_note;
    } else if (input.mode === "edit") {
      if (input.forbidden_action) body.forbidden_action = input.forbidden_action;
      if (input.signer) body.signer = input.signer;
      if (input.authority_text !== undefined) body.authority_text = input.authority_text;
      if (input.domain) body.domain = input.domain;
      if (typeof input.charge === "number") body.charge = input.charge;
    }

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/permission-slips/${input.permission_slip_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `respond failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { permission_slip?: PermissionSlip };
    const p = j.permission_slip;
    if (!p) return { ok: false, error: "no permission_slip returned" };
    return {
      ok: true,
      permission_slip_id: p.id,
      status: p.status,
      resolution_note: p.resolution_note,
      pinned: p.pinned,
      archived_at: p.archived_at,
      forbidden_action: p.forbidden_action,
      signer: p.signer,
      authority_text: p.authority_text,
    };
  },
});
