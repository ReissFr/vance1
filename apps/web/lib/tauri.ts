type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriWindow {
  __TAURI_INTERNALS__?: { invoke: InvokeFn };
  __TAURI__?: { invoke?: InvokeFn };
}

export function isTauri(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as TauriWindow;
  return Boolean(w.__TAURI_INTERNALS__ ?? w.__TAURI__);
}

export function tauriInvoke(): InvokeFn | null {
  if (typeof window === "undefined") return null;
  const w = window as TauriWindow;
  return w.__TAURI_INTERNALS__?.invoke ?? w.__TAURI__?.invoke ?? null;
}

export function deviceKind(): "mac" | "web" {
  return isTauri() ? "mac" : "web";
}

export async function runDeviceAction(
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; output: string }> {
  const invoke = tauriInvoke();
  if (!invoke) {
    return { ok: false, output: "not running in desktop app" };
  }
  try {
    const result = (await invoke(name, args)) as { ok: boolean; output: string };
    return result;
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}

export interface ScreenContext {
  app: string;
  text: string;
  captured_at: number;
}

// Fetch the latest cached OCR context from the ambient screen sensor.
// Returns null if sensor is off, permission missing, or capture is stale
// (older than maxAgeSec, default 60s).
export async function getScreenContext(maxAgeSec = 60): Promise<ScreenContext | null> {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  try {
    const ctx = (await invoke("screen_get_context")) as ScreenContext | null;
    if (!ctx || !ctx.text?.trim()) return null;
    const ageSec = Math.floor(Date.now() / 1000) - ctx.captured_at;
    if (ageSec > maxAgeSec) return null;
    return ctx;
  } catch {
    return null;
  }
}

export async function captureScreenBase64(): Promise<string | null> {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  try {
    const result = (await invoke("capture_screen")) as { ok: boolean; output: string };
    if (!result.ok) return null;
    const prefix = "data:image/jpeg;base64,";
    if (result.output.startsWith(prefix)) return result.output.slice(prefix.length);
    return result.output;
  } catch {
    return null;
  }
}
