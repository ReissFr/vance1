// Crypto-action runner — executes approved crypto_send and crypto_whitelist_add
// tasks. Triggered by the brain's crypto_action_respond tool after the user
// replies YES on WhatsApp.
//
// Lifecycle:
//   brain.crypto_send            → tasks row (kind='crypto_send',   status='needs_approval')
//   brain.crypto_save_address    → tasks row (kind='crypto_whitelist_add', status='needs_approval')
//   WhatsApp approval sent via sendCryptoCheckpointWhatsApp
//   user replies yes/no          → brain.crypto_action_respond flips task to queued, fires this runner
//   this file                    → performs the action, settles the task
//
// Two-factor (Coinbase only):
//   If provider.send returns { status: 'two_factor_required' }, the task
//   flips back to needs_approval with phase='awaiting_2fa' and a fresh
//   WhatsApp prompt asking for the 2FA code. The user's 2FA reply goes
//   through the same crypto_action_respond tool with kind='2fa'.
//
// Idempotency:
//   state.idempotency_key is generated once at crypto_send time and reused
//   across retries (including the 2FA round). Coinbase dedupes on `idem`
//   server-side, Kraken dedupes by the (key, amount) match + our check that
//   we never re-send after status='done'.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCryptoProvider, type CryptoSendRequest } from "@jarvis/integrations";
import { supabaseAdmin } from "./supabase/server";
import { dispatchNotification } from "./notify";

// --- Shared task-state shapes --------------------------------------------

export type CryptoSendPhase =
  | "awaiting_user_approval"
  | "awaiting_2fa"
  | "executing"
  | "done"
  | "failed";

export type CryptoSendState = {
  version: 1;
  kind: "crypto_send";
  phase: CryptoSendPhase;
  // Everything needed to re-execute from scratch on retry.
  provider: string;
  wallet_id: string;
  asset: string;
  amount: string;
  destination: string;
  destination_label: string;
  network: string | null;
  idempotency_key: string;
  // Filled on the 2FA round.
  two_factor_token?: string;
  // Latest WhatsApp prompt waiting on a user reply (null when executing/done).
  pending_prompt: string | null;
  // Provider result once submitted.
  provider_tx_id?: string;
  error?: string;
  history: CryptoHistoryEntry[];
};

export type CryptoWhitelistAddState = {
  version: 1;
  kind: "crypto_whitelist_add";
  phase: "awaiting_user_approval" | "done" | "cancelled";
  label: string;
  asset: string;
  network: string | null;
  address: string;
  provider: string | null;
  pending_prompt: string | null;
  history: CryptoHistoryEntry[];
};

export type CryptoTaskState = CryptoSendState | CryptoWhitelistAddState;

export type CryptoHistoryEntry = {
  at: string;
  event: string;
  detail?: string;
};

// --- Runner --------------------------------------------------------------

export async function runCryptoActionTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<void> {
  const { data: task, error } = await admin
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (error || !task) {
    console.error("[crypto-send] task not found:", taskId, error?.message);
    return;
  }
  if (task.status !== "queued") {
    console.log("[crypto-send] task not queued, skipping:", taskId, task.status);
    return;
  }

  await admin
    .from("tasks")
    .update({ status: "running", started_at: task.started_at ?? new Date().toISOString() })
    .eq("id", taskId);

  let state: CryptoTaskState;
  try {
    state = task.result ? (JSON.parse(task.result as string) as CryptoTaskState) : null as never;
    if (!state) throw new Error("task has no result state");
  } catch (e) {
    await failTask(admin, taskId, `corrupt task state: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  try {
    if (task.kind === "crypto_whitelist_add") {
      await runWhitelistAdd(admin, task.id, task.user_id, state as CryptoWhitelistAddState);
      return;
    }
    if (task.kind === "crypto_send") {
      await runSend(admin, task.id, task.user_id, state as CryptoSendState);
      return;
    }
    await failTask(admin, taskId, `unknown crypto action kind: ${task.kind}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await failTask(admin, taskId, msg);
  }
}

async function runWhitelistAdd(
  admin: SupabaseClient,
  taskId: string,
  userId: string,
  state: CryptoWhitelistAddState,
): Promise<void> {
  // If we ever reach run with phase already done/cancelled, something's off —
  // treat as idempotent success.
  if (state.phase === "done") {
    await markDone(admin, taskId, state);
    return;
  }
  if (state.phase === "cancelled") {
    await admin
      .from("tasks")
      .update({
        status: "cancelled",
        completed_at: new Date().toISOString(),
        result: JSON.stringify(state),
      })
      .eq("id", taskId);
    return;
  }

  // User approved — persist the whitelist row. Duplicate-label rows are
  // blocked by the unique index, so we catch the error and treat as success.
  const { error } = await admin.from("crypto_whitelist_addresses").upsert(
    {
      user_id: userId,
      label: state.label,
      asset: state.asset,
      network: state.network,
      address: state.address,
      provider: state.provider,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,label" },
  );
  if (error) {
    state.phase = "done";
    state.history.push({ at: iso(), event: "whitelist_save_failed", detail: error.message });
    await failTask(admin, taskId, `Couldn't save whitelist address: ${error.message}`);
    await sendWhatsApp(admin, userId, taskId, `⚠️ Couldn't save '${state.label}': ${error.message}`);
    return;
  }

  state.phase = "done";
  state.history.push({ at: iso(), event: "whitelist_saved" });
  await markDone(admin, taskId, state);
  await sendWhatsApp(
    admin,
    userId,
    taskId,
    `✅ Saved '${state.label}' (${state.asset}${state.network ? ` on ${state.network}` : ""}) to your crypto whitelist.`,
  );
}

async function runSend(
  admin: SupabaseClient,
  taskId: string,
  userId: string,
  state: CryptoSendState,
): Promise<void> {
  if (state.phase === "done" || state.phase === "failed") {
    // Idempotent — don't re-send on a retry.
    await admin
      .from("tasks")
      .update({
        status: state.phase === "done" ? "done" : "failed",
        completed_at: new Date().toISOString(),
        result: JSON.stringify(state),
      })
      .eq("id", taskId);
    return;
  }

  state.phase = "executing";
  state.pending_prompt = null;

  // Look up the active crypto integration to confirm the provider matches the
  // task (user may have reconnected a different provider since the task was
  // queued). Resolver handles loading credentials + persistence.
  const provider = await getCryptoProvider(admin, userId);
  if (provider.providerName !== state.provider) {
    const msg = `Active crypto provider is ${provider.providerName}, but task was queued for ${state.provider}. Re-issue the send.`;
    state.error = msg;
    state.phase = "failed";
    await failTask(admin, taskId, msg, state);
    await sendWhatsApp(admin, userId, taskId, `⚠️ Crypto send failed: ${msg}`);
    return;
  }

  const req: CryptoSendRequest = {
    wallet_id: state.wallet_id,
    asset: state.asset,
    amount: state.amount,
    destination: state.destination,
    destination_label: state.destination_label,
    network: state.network ?? undefined,
    idempotency_key: state.idempotency_key,
    two_factor_token: state.two_factor_token,
  };

  const result = await provider.send(req);

  if (result.status === "two_factor_required") {
    // Flip back to needs_approval and ask for the 2FA code over WhatsApp.
    state.phase = "awaiting_2fa";
    state.pending_prompt = `🔐 Coinbase 2FA needed for sending ${state.amount} ${state.asset} to '${state.destination_label}'. Reply with the 6-digit code.`;
    state.history.push({ at: iso(), event: "two_factor_requested" });
    await admin
      .from("tasks")
      .update({
        status: "needs_approval",
        needs_approval_at: new Date().toISOString(),
        result: JSON.stringify(state),
      })
      .eq("id", taskId);
    await sendWhatsApp(admin, userId, taskId, state.pending_prompt);
    return;
  }

  if (result.status === "failed") {
    state.error = result.error;
    state.phase = "failed";
    state.history.push({ at: iso(), event: "send_failed", detail: result.error });
    await failTask(admin, taskId, result.error, state);
    await sendWhatsApp(
      admin,
      userId,
      taskId,
      `⚠️ Crypto send failed: ${result.error}`,
    );
    return;
  }

  // completed or pending
  state.provider_tx_id = result.provider_tx_id;
  state.phase = "done";
  state.history.push({
    at: iso(),
    event: result.status === "completed" ? "send_completed" : "send_pending",
    detail: result.provider_tx_id,
  });
  await markDone(admin, taskId, state);
  const verb = result.status === "completed" ? "Sent" : "Submitted";
  await sendWhatsApp(
    admin,
    userId,
    taskId,
    `✅ ${verb} ${state.amount} ${state.asset} to '${state.destination_label}'.${
      result.status === "pending" ? " Will settle on-chain." : ""
    }`,
  );
}

// --- Helpers -------------------------------------------------------------

async function markDone(
  admin: SupabaseClient,
  taskId: string,
  state: CryptoTaskState,
): Promise<void> {
  await admin
    .from("tasks")
    .update({
      status: "done",
      completed_at: new Date().toISOString(),
      result: JSON.stringify(state),
    })
    .eq("id", taskId);
}

async function failTask(
  admin: SupabaseClient,
  taskId: string,
  error: string,
  state?: CryptoTaskState,
): Promise<void> {
  await admin
    .from("tasks")
    .update({
      status: "failed",
      error,
      completed_at: new Date().toISOString(),
      ...(state ? { result: JSON.stringify(state) } : {}),
    })
    .eq("id", taskId);
}

function iso(): string {
  return new Date().toISOString();
}

// --- WhatsApp checkpoint (called by the brain tools before queueing) -----

export async function sendCryptoCheckpointWhatsApp(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  prompt: string,
): Promise<void> {
  await sendWhatsApp(admin, userId, taskId, prompt);
}

async function sendWhatsApp(
  admin: SupabaseClient,
  userId: string,
  taskId: string,
  body: string,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("mobile_e164")
    .eq("id", userId)
    .single();
  if (!profile?.mobile_e164) return;
  const { data: notif, error } = await admin
    .from("notifications")
    .insert({
      user_id: userId,
      task_id: taskId,
      channel: "whatsapp",
      to_e164: profile.mobile_e164,
      body,
      status: "queued",
    })
    .select("id")
    .single();
  if (error || !notif) {
    console.warn("[crypto-send] notification insert failed:", error?.message);
    return;
  }
  try {
    await dispatchNotification(admin, notif.id);
  } catch (e) {
    console.warn("[crypto-send] dispatch failed:", e);
  }
}

// Export the admin factory via the module index so the brain tool can
// fire-and-forget the runner without importing from @/lib/... directly.
export const _internal = { supabaseAdmin };
