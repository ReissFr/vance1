"use client";

// Mounted in the root layout. When the page is running inside the Tauri
// desktop app, this component subscribes to pending_client_actions rows for
// the authenticated user, executes each via a Tauri invoke, and posts the
// result back to the server so the brain (often waiting for the outcome
// inside a WhatsApp-inbound run) can continue. In the regular browser it's
// a no-op.

import { useEffect, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isTauri, runDeviceAction } from "@/lib/tauri";

interface PendingRow {
  id: string;
  user_id: string;
  tool_name: string;
  tool_args: Record<string, unknown> | null;
  status: string;
}

export default function ClientActionRunner() {
  const running = useRef(new Set<string>());

  useEffect(() => {
    console.log("[CAR] isTauri:", isTauri());
    if (!isTauri()) return;
    const supabase = supabaseBrowser();
    let cancelled = false;

    const claimAndRun = async (row: PendingRow) => {
      if (running.current.has(row.id)) return;
      running.current.add(row.id);
      try {
        // Atomic claim — only succeeds if this row is still pending.
        const { data: claimed } = await supabase
          .from("pending_client_actions")
          .update({ status: "running", started_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();
        if (!claimed) return; // someone else claimed (or row changed).

        const args = (row.tool_args ?? {}) as Record<string, unknown>;
        const result = await runDeviceAction(row.tool_name, args);

        await fetch(`/api/client-actions/${row.id}/result`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            result.ok
              ? { status: "completed", result }
              : { status: "failed", error: result.output || "unknown error" },
          ),
        });
      } catch (e) {
        await fetch(`/api/client-actions/${row.id}/result`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "failed", error: e instanceof Error ? e.message : String(e) }),
        }).catch(() => {});
      } finally {
        running.current.delete(row.id);
      }
    };

    const pollPending = async (userId: string) => {
      const { data: pending } = await supabase
        .from("pending_client_actions")
        .select("id, user_id, tool_name, tool_args, status")
        .eq("user_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: true });
      if (pending && !cancelled) for (const row of pending) void claimAndRun(row as PendingRow);
    };

    const bootstrap = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      console.log("[CAR] user:", user?.id ?? "NULL");
      if (!user || cancelled) return () => {};

      await pollPending(user.id);
      const interval = setInterval(() => {
        if (!cancelled) void pollPending(user.id);
      }, 2000);
      return () => clearInterval(interval);
    };

    const cleanupPromise = bootstrap();
    return () => {
      cancelled = true;
      void cleanupPromise.then((fn) => fn && fn());
    };
  }, []);

  return null;
}
