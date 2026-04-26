// Opens a URL in JARVIS's persistent Chromium browser so the user can sign
// in. Used by the /sites page — one click pops the login page, user signs
// in, cookies persist in ~/.jarvis/browser-profile for every future task.
// No brain turn involved.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { executeBrowserAction } from "@/lib/browser";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let body: { url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const url = body.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ ok: false, error: "valid http(s) url required" }, { status: 400 });
  }

  const result = await executeBrowserAction({ type: "open", url }, { userId: user.id });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.output ?? "open failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, url: result.url, title: result.title });
}
