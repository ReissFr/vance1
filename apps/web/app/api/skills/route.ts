// Lists installed skills (filesystem: skills/<name>/SKILL.md) and learned
// skills (database: learned_skills table). Both feed the /skills viewer UI.

import { NextResponse } from "next/server";
import { join } from "node:path";
import { supabaseServer } from "@/lib/supabase/server";
import { loadSkillIndex } from "@jarvis/agent";

export const runtime = "nodejs";

const SKILLS_DIR = join(process.cwd(), "skills");

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [installed, learnedRes] = await Promise.all([
    loadSkillIndex(SKILLS_DIR).catch(() => []),
    supabase
      .from("learned_skills")
      .select(
        "id, name, description, site, status, version, verified_count, failed_count, last_verified_at, last_failed_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return NextResponse.json({
    installed: installed.map((s) => ({
      name: s.name,
      description: s.description,
      dir: s.dir,
    })),
    learned: learnedRes.data ?? [],
  });
}
