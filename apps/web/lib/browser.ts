// Public facade for the browser-providers registry. All call sites continue
// to `import { executeBrowserAction } from "@/lib/browser"`; actual execution
// dispatches through whatever BrowserProvider is selected at boot (local by
// default; Fly/Browserbase providers pluggable via JARVIS_BROWSER env).

export {
  executeBrowserAction,
  getBrowserProvider,
  closeBrowserProvider,
} from "./browser-providers";

export type {
  BrowserAction,
  BrowserResult,
  BrowserProvider,
  BrowserExecContext,
} from "./browser-providers/types";
