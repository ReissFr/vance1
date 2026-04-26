"use client";

// Mounted in the root layout. When the desktop app fires a
// `gesture:thumbs_up` Tauri event (from the gesture-sense sidecar), this
// component approves the most recent `needs_approval` task the user owns.
//
// Only kinds that approve with an empty body are handled — concierge (the
// £150-over-limit case), inbox, outreach, and non-email writer formats.
// Email writer tasks still need an explicit recipient and fall through.
//
// In the regular browser this component is a no-op.

import { useEffect } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { isTauri } from "@/lib/tauri";

type PendingTask = {
  id: string;
  kind: string;
  args: { format?: string } | null;
};

export default function GestureApprover() {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let inflight = false;

    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      unlisten = await listen("gesture:thumbs_up", async () => {
        if (inflight) return;
        inflight = true;
        try {
          await approveMostRecent();
        } finally {
          inflight = false;
        }
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return null;
}

async function approveMostRecent(): Promise<void> {
  const supabase = supabaseBrowser();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, kind, args")
    .eq("user_id", user.id)
    .eq("status", "needs_approval")
    .order("needs_approval_at", { ascending: false })
    .limit(5);
  if (!tasks || tasks.length === 0) {
    notify("No pending approvals", "Thumbs-up seen but nothing is waiting.");
    return;
  }

  const task = pickThumbApprovable(tasks as PendingTask[]);
  if (!task) {
    notify(
      "Can't approve with thumbs-up",
      "Pending task needs extra info (recipient, selection) — use the app.",
    );
    return;
  }

  const res = await fetch(`/api/tasks/${task.id}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.ok) {
    notify("Approved", `${task.kind} task approved via thumbs-up.`);
  } else {
    const text = await res.text().catch(() => "");
    console.error("[gesture] approve failed:", res.status, text);
    notify("Approval failed", `Status ${res.status}`);
  }
}

function pickThumbApprovable(tasks: PendingTask[]): PendingTask | null {
  for (const t of tasks) {
    if (t.kind === "concierge") return t;
    if (t.kind === "inbox") return t;
    if (t.kind === "outreach") return t;
    if (t.kind === "writer") {
      const format = t.args?.format ?? "general";
      if (format !== "email" && format !== "cold_outreach") return t;
    }
  }
  return null;
}

function notify(title: string, body: string): void {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) {
    console.log(`[gesture] ${title}: ${body}`);
    return;
  }
  if (Notification.permission === "granted") {
    new Notification(title, { body });
  } else if (Notification.permission !== "denied") {
    void Notification.requestPermission().then((p) => {
      if (p === "granted") new Notification(title, { body });
    });
  } else {
    console.log(`[gesture] ${title}: ${body}`);
  }
}
