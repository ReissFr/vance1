"use client";

// Subscribes to the user's tasks stream globally so moves to
// needs_approval / failed fire a toast from any page — not just
// pages that happen to mount useTasks themselves (like /operations).
// Uses notifyOn to piggyback on useTasks's built-in notifier.

import { useTasks } from "./useTasks";

export function GlobalTaskNotifier() {
  useTasks({ notifyOn: ["needs_approval", "failed"], limit: 50 });
  return null;
}
