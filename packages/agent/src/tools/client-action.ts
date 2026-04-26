import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "./types";

// Shared helper for device tools. When the brain runs in an interactive
// context (live web chat / desktop), ctx.queueClientAction is absent and
// we fall back to the legacy stub — the client intercepts the tool_use
// event and executes via Tauri directly.
//
// When the brain runs in a non-interactive context (WhatsApp inbound, cron
// tasks), ctx.queueClientAction is wired: we insert a pending action row,
// block briefly on the desktop executing it, and return the actual result
// so the brain can keep reasoning. If the desktop is offline or slow we
// return a "pending" stub and the brain surfaces that to the user.

const WAIT_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 800;

export async function executeOrQueueClientAction(
  ctx: ToolContext,
  toolName: string,
  input: unknown,
  opts?: { expectsFollowup?: boolean; clientCommand?: string },
): Promise<unknown> {
  const clientCmd = opts?.clientCommand ?? toolName;
  if (!ctx.queueClientAction) {
    const base: Record<string, unknown> = { queued: true, client_action: clientCmd, args: input };
    if (opts?.expectsFollowup) base.expects_followup = true;
    return base;
  }

  const { id } = await ctx.queueClientAction({ toolName: clientCmd, toolArgs: input });

  const settled = await waitForClientActionResult(ctx.supabase, id);
  if (!settled) {
    return {
      queued: true,
      action_id: id,
      status: "pending",
      message: `Queued "${clientCmd}" on the desktop but it hasn't completed yet. Tell the user you've queued it and you'll message them when it finishes.`,
    };
  }
  if (settled.status === "failed") {
    return {
      queued: true,
      action_id: id,
      status: "failed",
      error: settled.error ?? "desktop reported failure",
    };
  }
  return {
    queued: true,
    action_id: id,
    status: "completed",
    result: settled.result,
  };
}

async function waitForClientActionResult(
  supabase: SupabaseClient,
  id: string,
): Promise<{ status: string; result: unknown; error: string | null } | null> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from("pending_client_actions")
      .select("status, result, error")
      .eq("id", id)
      .single();
    if (data && (data.status === "completed" || data.status === "failed")) {
      return data as { status: string; result: unknown; error: string | null };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
