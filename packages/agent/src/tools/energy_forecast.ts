// Brain tools for Energy Forecast — JARVIS predicts the user's
// energy/mood/focus for any upcoming day on a 1-5 scale, paired with a
// short narrative ("low-energy slow start, focus window 14:00-16:30")
// and 2-4 concrete recommendations. The user later logs an actual
// daily check-in for that date and the row's accuracy_score is stamped,
// so JARVIS calibrates its self-model over time.
//
// Use these when the user says things like "what's tomorrow going to
// feel like", "should I book deep work on Friday", "predict my energy
// for next Monday", "am I going to crash this week", or as a normal
// closing of the evening (forecast tomorrow before sleep).

import { z } from "zod";
import { defineTool } from "./types";

type Forecast = {
  id: string;
  forecast_date: string;
  energy_pred: number;
  mood_pred: number;
  focus_pred: number;
  confidence: number;
  narrative: string;
  recommendations: string[];
  source_summary: string | null;
  source_counts: Record<string, number> | null;
  actual_energy: number | null;
  actual_mood: number | null;
  actual_focus: number | null;
  accuracy_score: number | null;
  scored_at: string | null;
  user_note: string | null;
  pinned: boolean;
  created_at: string;
};

export const forecastEnergyTool = defineTool({
  name: "forecast_energy",
  description: [
    "Forecast the user's energy / mood / focus on a 1-5 scale for an",
    "upcoming day, with a short narrative and 2-4 recommendations.",
    "Optional: forecast_date (YYYY-MM-DD, default tomorrow). Idempotent",
    "per (user, date) — calling for the same date overwrites the",
    "previous forecast.",
    "",
    "Use when the user asks 'what'll tomorrow feel like', 'should I",
    "book deep work on Friday', 'am I going to crash this week', or",
    "as a normal evening close ('forecast tomorrow before I sleep').",
    "Don't run for the same date repeatedly — once a day is enough.",
    "",
    "Requires at least 3 daily check-ins in the last 30d. Returns the",
    "forecast id, predictions, narrative, recommendations, and source",
    "summary so you can read it back to the user.",
  ].join("\n"),
  schema: z.object({
    forecast_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: { forecast_date: { type: "string" } },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/energy-forecasts`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify(input.forecast_date ? { forecast_date: input.forecast_date } : {}),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `forecast failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { forecast?: Forecast };
    if (!j.forecast) return { ok: false, error: "no forecast produced" };
    const f = j.forecast;
    return {
      ok: true,
      forecast: {
        id: f.id,
        date: f.forecast_date,
        energy: f.energy_pred,
        mood: f.mood_pred,
        focus: f.focus_pred,
        confidence: f.confidence,
        narrative: f.narrative,
        recommendations: f.recommendations,
        source_summary: f.source_summary,
      },
    };
  },
});

export const listEnergyForecastsTool = defineTool({
  name: "list_energy_forecasts",
  description: [
    "List the user's recent energy forecasts. Optional: status (all |",
    "upcoming | scored | unscored, default all); limit (default 20).",
    "Includes a calibration block (avg accuracy across scored rows) so",
    "you can read it back to the user — 'your last 12 forecasts",
    "averaged 3.6/5 accuracy, you're under-predicting Friday energy'.",
    "",
    "Use when the user asks 'how good are your forecasts', 'show me",
    "the upcoming days', 'what did you predict for yesterday'.",
  ].join("\n"),
  schema: z.object({
    status: z.enum(["all", "upcoming", "scored", "unscored"]).optional().default("all"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  }),
  inputSchema: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["all", "upcoming", "scored", "unscored"] },
      limit: { type: "number" },
    },
  },
  async run(input, ctx) {
    const status = input.status ?? "all";
    const limit = Math.max(1, Math.min(100, input.limit ?? 20));

    let q = ctx.supabase
      .from("energy_forecasts")
      .select("id, forecast_date, energy_pred, mood_pred, focus_pred, confidence, narrative, recommendations, source_summary, actual_energy, actual_mood, actual_focus, accuracy_score, scored_at, user_note, pinned, created_at")
      .eq("user_id", ctx.userId);
    const today = new Date().toISOString().slice(0, 10);
    if (status === "upcoming") q = q.gte("forecast_date", today);
    else if (status === "scored") q = q.not("scored_at", "is", null);
    else if (status === "unscored") q = q.is("scored_at", null).lt("forecast_date", today);
    q = q.order("forecast_date", { ascending: false }).limit(limit);

    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as unknown as Forecast[];

    const scored = rows.filter((r) => r.scored_at != null && r.accuracy_score != null);
    const calibration = scored.length
      ? {
          scored: scored.length,
          avg_accuracy: Math.round((scored.reduce((s, r) => s + (r.accuracy_score ?? 0), 0) / scored.length) * 10) / 10,
        }
      : null;

    return {
      ok: true,
      count: rows.length,
      calibration,
      forecasts: rows.map((r) => ({
        id: r.id,
        date: r.forecast_date,
        energy: r.energy_pred,
        mood: r.mood_pred,
        focus: r.focus_pred,
        confidence: r.confidence,
        narrative: r.narrative,
        actual_energy: r.actual_energy,
        actual_mood: r.actual_mood,
        actual_focus: r.actual_focus,
        accuracy_score: r.accuracy_score,
        pinned: r.pinned,
      })),
    };
  },
});

export const scoreEnergyForecastTool = defineTool({
  name: "score_energy_forecast",
  description: [
    "Stamp the actual energy / mood / focus values for a past forecast",
    "so JARVIS can score itself. Required: forecast_id, actual_energy",
    "(1-5), actual_mood (1-5), actual_focus (1-5). Server computes",
    "accuracy_score from mean absolute error vs predictions.",
    "",
    "Use when the user retroactively tells you how a day actually felt",
    "('yesterday was a 2/5 not a 4/5 — I was wiped'). Don't guess —",
    "pull from a daily_checkin if one was logged for that date, or",
    "ask the user directly.",
  ].join("\n"),
  schema: z.object({
    forecast_id: z.string().uuid(),
    actual_energy: z.number().int().min(1).max(5),
    actual_mood: z.number().int().min(1).max(5),
    actual_focus: z.number().int().min(1).max(5),
  }),
  inputSchema: {
    type: "object",
    required: ["forecast_id", "actual_energy", "actual_mood", "actual_focus"],
    properties: {
      forecast_id: { type: "string" },
      actual_energy: { type: "number" },
      actual_mood: { type: "number" },
      actual_focus: { type: "number" },
    },
  },
  async run(input, ctx) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "";
    if (!baseUrl) return { ok: false, error: "APP_URL not configured" };
    const sessionToken = (
      ctx.supabase as unknown as { rest: { headers: Record<string, string> } }
    ).rest?.headers?.Authorization;
    if (!sessionToken) return { ok: false, error: "no session token" };

    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/api/energy-forecasts/${input.forecast_id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: sessionToken },
      body: JSON.stringify({
        actual_energy: input.actual_energy,
        actual_mood: input.actual_mood,
        actual_focus: input.actual_focus,
      }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      return { ok: false, error: `score failed (${r.status}): ${err.slice(0, 240)}` };
    }
    const j = (await r.json()) as { forecast?: { id: string; accuracy_score: number | null; energy_pred: number; mood_pred: number; focus_pred: number; actual_energy: number | null; actual_mood: number | null; actual_focus: number | null } };
    if (!j.forecast) return { ok: false, error: "no row returned" };
    return {
      ok: true,
      forecast: j.forecast,
    };
  },
});
