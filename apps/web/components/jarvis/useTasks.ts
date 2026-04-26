"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { toast } from "./ToastHost";

export type TaskRow = {
  id: string;
  user_id: string;
  kind: string;
  status: "queued" | "running" | "needs_approval" | "done" | "failed" | "cancelled";
  prompt: string;
  args: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  completed_at?: string | null;
};

type Options = {
  status?: TaskRow["status"] | TaskRow["status"][];
  limit?: number;
  notifyOn?: Array<TaskRow["status"]>;
};

export function useTasks(opts: Options = {}) {
  const { limit = 50, notifyOn } = opts;
  const statuses = Array.isArray(opts.status)
    ? opts.status
    : opts.status
    ? [opts.status]
    : null;
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const channelIdRef = useRef<string>("");
  if (!channelIdRef.current) {
    channelIdRef.current = Math.random().toString(36).slice(2, 10);
  }
  const statusKey = statuses?.join(",") ?? "";
  const notifyKey = notifyOn?.join(",") ?? "";

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const matches = (t: TaskRow) => (statuses ? statuses.includes(t.status) : true);

    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setUserId(user.id);

      let q = supabase
        .from("tasks")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (statuses) q = q.in("status", statuses);

      const { data } = await q;
      if (cancelled || !data) return;
      const rows = data as TaskRow[];
      seenIdsRef.current = new Set(rows.map((r) => r.id));
      setTasks(rows);
      firstLoadRef.current = false;

      channel = supabase
        .channel(`tasks-live:${user.id}:${channelIdRef.current}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "tasks",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            setTasks((prev) => {
              const list = prev ?? [];
              if (payload.eventType === "DELETE") {
                const id = (payload.old as TaskRow).id;
                seenIdsRef.current.delete(id);
                return list.filter((t) => t.id !== id);
              }
              const row = payload.new as TaskRow;
              const wasSeen = seenIdsRef.current.has(row.id);
              seenIdsRef.current.add(row.id);

              const shouldNotify =
                !firstLoadRef.current &&
                !wasSeen &&
                (notifyOn?.includes(row.status) ?? false);
              if (shouldNotify) {
                const args = (row.args ?? {}) as { title?: string; summary?: string };
                toast({
                  variant:
                    row.status === "needs_approval"
                      ? "attention"
                      : row.status === "done"
                      ? "success"
                      : row.status === "failed"
                      ? "error"
                      : "info",
                  title: args.title ?? args.summary ?? row.prompt ?? row.kind,
                  meta: row.kind.toUpperCase(),
                });
              }

              if (!matches(row)) {
                return list.filter((t) => t.id !== row.id);
              }
              const filtered = list.filter((t) => t.id !== row.id);
              return [row, ...filtered].slice(0, limit);
            });
          },
        )
        .subscribe();
    };

    void load();

    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit, statusKey, notifyKey]);

  return { tasks, userId };
}
