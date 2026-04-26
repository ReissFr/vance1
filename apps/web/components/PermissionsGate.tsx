"use client";

import { useEffect, useState } from "react";
import { isTauri, tauriInvoke } from "@/lib/tauri";

interface Perms {
  accessibility: boolean;
  screen_recording: boolean;
  full_disk_access: boolean;
}

const LABELS: Record<keyof Perms, { name: string; why: string }> = {
  accessibility: {
    name: "Accessibility",
    why: "Type text, press keys, and read app content",
  },
  screen_recording: {
    name: "Screen Recording",
    why: "Capture screenshots when you ask what's on screen",
  },
  full_disk_access: {
    name: "Full Disk Access",
    why: "Read iMessages and other protected data",
  },
};

export function PermissionsGate() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const invoke = tauriInvoke();
    if (!invoke) return;

    const poll = () =>
      invoke("check_permissions", {})
        .then((p) => setPerms(p as Perms))
        .catch(() => {});

    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  if (!perms || dismissed) return null;

  const missing = (Object.keys(LABELS) as (keyof Perms)[]).filter(
    (k) => !perms[k],
  );
  if (missing.length === 0 || dismissed) return null;

  const openSettings = (key: string) => {
    const invoke = tauriInvoke();
    if (invoke) void invoke("open_permission_settings", { permission: key });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-zinc-900 border border-white/10 rounded-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold mb-1">Permissions needed</h2>
        <p className="text-white/50 text-sm mb-4">
          JARVIS needs a few macOS permissions to control your computer.
        </p>
        <div className="space-y-3">
          {(Object.keys(LABELS) as (keyof Perms)[]).map((key) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/5"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      perms[key] ? "text-green-400" : "text-yellow-400"
                    }
                  >
                    {perms[key] ? "\u2713" : "\u25CB"}
                  </span>
                  <span className="font-medium text-sm">
                    {LABELS[key].name}
                  </span>
                </div>
                <p className="text-white/40 text-xs mt-0.5 pl-5">
                  {LABELS[key].why}
                </p>
              </div>
              {!perms[key] && (
                <button
                  onClick={() => openSettings(key)}
                  className="shrink-0 text-xs px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 transition"
                >
                  Grant
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={() => {
              setDismissed(true);
              try { localStorage.setItem("jarvis-perms-dismissed", "1"); } catch {}
            }}
            className="text-xs text-white/40 hover:text-white/60"
          >
            Skip for now
          </button>
          {missing.length === 0 && (
            <button
              onClick={() => setDismissed(true)}
              className="text-xs px-4 py-1.5 rounded bg-accent hover:bg-accent/80"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
