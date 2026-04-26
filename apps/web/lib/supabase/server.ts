import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(all: { name: string; value: string; options: CookieOptions }[]) {
          try {
            all.forEach(({ name, value, options }) => {
              const persistent: CookieOptions = {
                ...options,
                sameSite: "lax",
                path: "/",
                maxAge: options.maxAge ?? 60 * 60 * 24 * 30,
              };
              cookieStore.set(name, value, persistent);
            });
          } catch {
            // called from a Server Component — ignore, middleware refreshes cookies.
          }
        },
      },
    },
  );
}

export function supabaseAdmin() {
  // Service role client — server only. Bypasses RLS; use only when you've authenticated the caller yourself.
  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}
