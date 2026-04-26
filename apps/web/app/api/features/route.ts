// GET: returns every feature in the registry with the user's enable state
// merged in, plus which requirements are satisfied. The UI uses this to
// render the feature library grid.

import { NextResponse } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { FEATURES, type FeatureRequirement } from "@/lib/features";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = supabaseAdmin();

  const [{ data: flags }, { data: integrations }, { data: profile }] = await Promise.all([
    admin.from("user_features").select("feature_id, enabled").eq("user_id", user.id),
    admin.from("integrations").select("kind").eq("user_id", user.id).eq("active", true),
    admin.from("profiles").select("google_access_token, mobile_e164").eq("id", user.id).single(),
  ]);

  const overrides = new Map<string, boolean>();
  for (const row of flags ?? []) overrides.set(row.feature_id, row.enabled);

  const integrationKinds = new Set((integrations ?? []).map((r) => r.kind as string));
  const hasGoogle = Boolean(profile?.google_access_token);
  const hasWhatsApp = Boolean(profile?.mobile_e164);

  const satisfied = (req: FeatureRequirement): boolean => {
    switch (req) {
      case "desktop":
        // Only the client can know for sure; server answers "yes, it's available
        // as a feature" and the UI hides the toggle when not in Tauri.
        return true;
      case "gmail":
      case "calendar":
        return hasGoogle;
      case "stripe":
        return integrationKinds.has("payments");
      case "banking":
        return integrationKinds.has("banking");
      case "home":
        return integrationKinds.has("home");
      case "twilio":
        return hasWhatsApp;
      default:
        return true;
    }
  };

  const items = FEATURES.map((f) => {
    const override = overrides.get(f.id);
    const enabled = override ?? f.defaultEnabled;
    const missing = f.requires.filter((r) => !satisfied(r));
    return {
      id: f.id,
      category: f.category,
      name: f.name,
      tagline: f.tagline,
      description: f.description,
      icon: f.icon,
      tier: f.tier,
      requires: f.requires,
      defaultEnabled: f.defaultEnabled,
      enabled,
      available: missing.length === 0,
      missingRequirements: missing,
    };
  });

  return NextResponse.json({ features: items });
}
