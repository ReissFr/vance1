// Profile read/update endpoint. Backs the onboarding wizard and the settings
// page. Accepts the preference fields the rest of the app already reads
// (timezone, briefing_enabled, proactive_enabled, concierge_auto_limit_gbp)
// plus onboarded_at which the home page uses to gate the wizard.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { isValidE164 } from "@/lib/twilio";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data } = await supabaseAdmin()
    .from("profiles")
    .select(
      "display_name, mobile_e164, voice_id, timezone, briefing_enabled, evening_wrap_enabled, weekly_review_enabled, proactive_enabled, proactive_snoozed_until, quiet_start_hour, quiet_end_hour, concierge_auto_limit_gbp, google_access_token, onboarded_at",
    )
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    display_name: data?.display_name ?? null,
    mobile_e164: data?.mobile_e164 ?? null,
    voice_id: data?.voice_id ?? null,
    timezone: data?.timezone ?? null,
    briefing_enabled: data?.briefing_enabled ?? false,
    evening_wrap_enabled: data?.evening_wrap_enabled ?? false,
    weekly_review_enabled: data?.weekly_review_enabled ?? false,
    proactive_enabled: data?.proactive_enabled ?? false,
    proactive_snoozed_until: data?.proactive_snoozed_until ?? null,
    quiet_start_hour: data?.quiet_start_hour ?? 22,
    quiet_end_hour: data?.quiet_end_hour ?? 8,
    concierge_auto_limit_gbp: data?.concierge_auto_limit_gbp ?? null,
    google_connected: Boolean(data?.google_access_token),
    onboarded_at: data?.onboarded_at ?? null,
    email: user.email ?? null,
  });
}

interface PatchBody {
  mobile_e164?: string | null;
  display_name?: string | null;
  timezone?: string | null;
  voice_id?: string | null;
  briefing_enabled?: boolean;
  evening_wrap_enabled?: boolean;
  weekly_review_enabled?: boolean;
  proactive_enabled?: boolean;
  proactive_snoozed_until?: string | null;
  quiet_start_hour?: number | null;
  quiet_end_hour?: number | null;
  concierge_auto_limit_gbp?: number | null;
  onboarded?: boolean;
}

export async function PATCH(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as PatchBody;
  const update: Record<string, unknown> = {};

  if (body.mobile_e164 !== undefined) {
    if (body.mobile_e164 === null || body.mobile_e164 === "") {
      update.mobile_e164 = null;
    } else {
      const trimmed = body.mobile_e164.replace(/\s+/g, "");
      if (!isValidE164(trimmed)) {
        return NextResponse.json(
          { error: "mobile must be E.164 format, e.g. +447700900000" },
          { status: 400 },
        );
      }
      update.mobile_e164 = trimmed;
    }
  }
  if (body.display_name !== undefined) {
    update.display_name = body.display_name?.trim() || null;
  }
  if (body.timezone !== undefined) {
    update.timezone = body.timezone?.trim() || null;
  }
  if (body.voice_id !== undefined) {
    update.voice_id = body.voice_id?.trim() || null;
  }
  if (body.briefing_enabled !== undefined) {
    update.briefing_enabled = Boolean(body.briefing_enabled);
  }
  if (body.evening_wrap_enabled !== undefined) {
    update.evening_wrap_enabled = Boolean(body.evening_wrap_enabled);
  }
  if (body.weekly_review_enabled !== undefined) {
    update.weekly_review_enabled = Boolean(body.weekly_review_enabled);
  }
  if (body.proactive_enabled !== undefined) {
    update.proactive_enabled = Boolean(body.proactive_enabled);
  }
  if (body.proactive_snoozed_until !== undefined) {
    if (body.proactive_snoozed_until === null || body.proactive_snoozed_until === "") {
      update.proactive_snoozed_until = null;
    } else {
      const parsed = new Date(body.proactive_snoozed_until);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: "proactive_snoozed_until must be ISO 8601" },
          { status: 400 },
        );
      }
      update.proactive_snoozed_until = parsed.toISOString();
    }
  }
  if (body.quiet_start_hour !== undefined) {
    const n = body.quiet_start_hour == null ? null : Number(body.quiet_start_hour);
    if (n == null) {
      update.quiet_start_hour = 22;
    } else if (!Number.isInteger(n) || n < 0 || n > 23) {
      return NextResponse.json(
        { error: "quiet_start_hour must be integer 0-23" },
        { status: 400 },
      );
    } else {
      update.quiet_start_hour = n;
    }
  }
  if (body.quiet_end_hour !== undefined) {
    const n = body.quiet_end_hour == null ? null : Number(body.quiet_end_hour);
    if (n == null) {
      update.quiet_end_hour = 8;
    } else if (!Number.isInteger(n) || n < 0 || n > 23) {
      return NextResponse.json(
        { error: "quiet_end_hour must be integer 0-23" },
        { status: 400 },
      );
    } else {
      update.quiet_end_hour = n;
    }
  }
  if (body.concierge_auto_limit_gbp !== undefined) {
    if (body.concierge_auto_limit_gbp === null) {
      update.concierge_auto_limit_gbp = null;
    } else {
      const n = Number(body.concierge_auto_limit_gbp);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "concierge_auto_limit_gbp must be a non-negative number" },
          { status: 400 },
        );
      }
      update.concierge_auto_limit_gbp = n;
    }
  }
  if (body.onboarded === true) {
    update.onboarded_at = new Date().toISOString();
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabaseAdmin().from("profiles").update(update).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
