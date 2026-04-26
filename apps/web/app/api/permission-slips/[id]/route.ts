// PATCH/DELETE /api/permission-slips/[id] — resolve, pin, archive, or delete a permission-slip (§177).
//
// PATCH body: one of
//   { mode: 'sign_self',  resolution_note: REQUIRED } — the user signs their own permission slip
//   { mode: 're_sign',    resolution_note: REQUIRED } — accept the constraint with eyes open; name the legitimate reason
//   { mode: 'refuse',     resolution_note: REQUIRED } — the slip isn't real / authority is illegitimate
//   { mode: 'dismiss',    resolution_note?: optional } — false positive
//   { mode: 'unresolve' }
//   { mode: 'pin' | 'unpin' }
//   { mode: 'archive' | 'restore' }
//   { mode: 'edit', forbidden_action?, signer?, authority_text?, domain?, charge? }

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const VALID_MODES = new Set([
  "sign_self", "re_sign", "refuse", "dismiss", "unresolve",
  "pin", "unpin", "archive", "restore", "edit",
]);
const VALID_SIGNERS = new Set([
  "self", "parent", "partner", "peers", "society",
  "employer", "profession", "circumstance", "unknown",
]);
const VALID_DOMAINS = new Set([
  "work", "health", "relationships", "family", "finance",
  "creative", "self", "spiritual", "other",
]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  let body: {
    mode?: unknown;
    resolution_note?: unknown;
    forbidden_action?: unknown;
    signer?: unknown;
    authority_text?: unknown;
    domain?: unknown;
    charge?: unknown;
  };
  try { body = (await req.json()) as typeof body; } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const mode = typeof body.mode === "string" ? body.mode : "";
  if (!VALID_MODES.has(mode)) {
    return NextResponse.json({ error: `mode must be one of ${[...VALID_MODES].join("/")}` }, { status: 400 });
  }

  const note = typeof body.resolution_note === "string" ? body.resolution_note.trim().slice(0, 1500) : "";
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: nowIso };

  if (mode === "sign_self") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (the permission you are granting yourself) is required when mode='sign_self'" }, { status: 400 });
    }
    patch.status = "signed_by_self";
    patch.resolution_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "re_sign") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (the legitimate reason this constraint holds) is required when mode='re_sign'" }, { status: 400 });
    }
    patch.status = "re_signed";
    patch.resolution_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "refuse") {
    if (note.length < 4) {
      return NextResponse.json({ error: "resolution_note (why this slip isn't real / why the authority is illegitimate) is required when mode='refuse'" }, { status: 400 });
    }
    patch.status = "refused";
    patch.resolution_note = note;
    patch.resolved_at = nowIso;
  } else if (mode === "dismiss") {
    patch.status = "dismissed";
    patch.resolution_note = note || null;
    patch.resolved_at = nowIso;
  } else if (mode === "unresolve") {
    patch.status = "open";
    patch.resolution_note = null;
    patch.resolved_at = null;
  } else if (mode === "pin") {
    patch.pinned = true;
  } else if (mode === "unpin") {
    patch.pinned = false;
  } else if (mode === "archive") {
    patch.archived_at = nowIso;
  } else if (mode === "restore") {
    patch.archived_at = null;
  } else if (mode === "edit") {
    if (typeof body.forbidden_action === "string") {
      const v = body.forbidden_action.trim();
      if (v.length < 4) return NextResponse.json({ error: "forbidden_action too short" }, { status: 400 });
      patch.forbidden_action = v.slice(0, 280);
    }
    if (typeof body.signer === "string") {
      if (!VALID_SIGNERS.has(body.signer)) return NextResponse.json({ error: "invalid signer" }, { status: 400 });
      patch.signer = body.signer;
    }
    if (typeof body.authority_text === "string") {
      const v = body.authority_text.trim();
      patch.authority_text = v.length === 0 ? null : v.slice(0, 160);
    }
    if (typeof body.domain === "string") {
      if (!VALID_DOMAINS.has(body.domain)) return NextResponse.json({ error: "invalid domain" }, { status: 400 });
      patch.domain = body.domain;
    }
    if (typeof body.charge === "number") {
      patch.charge = Math.max(1, Math.min(5, Math.round(body.charge)));
    }
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: "edit mode requires at least one field" }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("permission_slips")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, scan_id, forbidden_action, signer, authority_text, domain, charge, recency, confidence, spoken_date, spoken_message_id, conversation_id, status, resolution_note, resolved_at, pinned, archived_at, latency_ms, model, created_at, updated_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, permission_slip: data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { error } = await supabase
    .from("permission_slips")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
