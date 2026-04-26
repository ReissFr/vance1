// Reports the current page state of JARVIS's Chromium browser. The /sites
// UI polls this after opening a login URL to auto-detect when the user has
// finished signing in (URL has left the login flow AND no visible password
// input). No brain turn involved.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { executeBrowserAction } from "@/lib/browser";

export const runtime = "nodejs";

const LOGIN_PATH_RE = /\/(login|signin|sign-in|auth|ap\/signin)(\/|$|\?)/i;

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { loginUrl?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const result = await executeBrowserAction({ type: "status" }, { userId: user.id });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.output ?? "status failed" },
      { status: 500 },
    );
  }

  const currentUrl = result.url ?? "";
  const hasPasswordInput = result.hasPasswordInput ?? true;
  const urlLooksLikeLogin = LOGIN_PATH_RE.test(currentUrl);

  // Signed in iff: no visible password input AND URL isn't a login URL AND
  // URL isn't the same login origin+path we were told to open (sanity check).
  let signedIn = !hasPasswordInput && !urlLooksLikeLogin;
  if (signedIn && body.loginUrl) {
    try {
      const loginUrl = new URL(body.loginUrl);
      const nowUrl = new URL(currentUrl);
      if (
        loginUrl.origin === nowUrl.origin &&
        loginUrl.pathname === nowUrl.pathname
      ) {
        signedIn = false;
      }
    } catch {
      /* ignore malformed URL */
    }
  }

  return NextResponse.json({
    ok: true,
    signedIn,
    url: currentUrl,
    title: result.title ?? "",
    hasPasswordInput,
  });
}
