// Universal search across all journal layers. Mirrors the cross_search +
// lookup_tag brain tools but exposed as an HTTP endpoint for the /search
// page. GET ?q=... does substring search via PostgREST .ilike, ?tag=...
// does exact-tag match via .contains, ?kinds=a,b filters which sources to
// hit. Returns a unified Hit[] sorted by date desc.

import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Hit = {
  kind: string;
  id: string;
  snippet: string;
  date: string | null;
  href: string;
  extra: Record<string, unknown>;
};

const ALL_KINDS = [
  "wins",
  "reflections",
  "decisions",
  "ideas",
  "questions",
  "knowledge_cards",
  "saved_prompts",
  "routines",
  "people",
  "intentions",
  "standups",
  "reading_list",
  "themes",
  "policies",
  "predictions",
] as const;

type Kind = typeof ALL_KINDS[number];

const TAG_KINDS = new Set<Kind>([
  "decisions",
  "ideas",
  "questions",
  "reflections",
  "saved_prompts",
  "people",
  "knowledge_cards",
  "routines",
  "themes",
  "policies",
  "predictions",
]);

function escapeIlike(s: string): string {
  return s.replace(/[%_]/g, (ch) => `\\${ch}`);
}

export async function GET(req: NextRequest) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const userId = user.id;
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const tag = req.nextUrl.searchParams.get("tag")?.trim() ?? "";
  const kindsParam = req.nextUrl.searchParams.get("kinds")?.trim() ?? "";
  const limit = parseInt(req.nextUrl.searchParams.get("limit_per_kind") ?? "8", 10) || 8;

  if (!q && !tag) {
    return NextResponse.json({ hits: [], q, tag });
  }

  const requestedKinds = kindsParam
    ? (kindsParam.split(",").filter((k) => (ALL_KINDS as readonly string[]).includes(k)) as Kind[])
    : null;
  const want = new Set<Kind>(
    requestedKinds && requestedKinds.length > 0 ? requestedKinds : ALL_KINDS,
  );

  const mode: "q" | "tag" = q ? "q" : "tag";
  const pat = q ? `%${escapeIlike(q)}%` : "";

  // For tag mode, filter to only sources that have a tags column.
  if (mode === "tag") {
    for (const k of [...want]) if (!TAG_KINDS.has(k)) want.delete(k);
  }

  const promises: Array<PromiseLike<Hit[]>> = [];

  if (want.has("wins")) {
    if (mode === "q") {
      promises.push(
        supabase
          .from("wins")
          .select("id, text, kind, amount_cents, created_at")
          .eq("user_id", userId)
          .ilike("text", pat)
          .order("created_at", { ascending: false })
          .limit(limit)
          .then(({ data }) =>
            ((data ?? []) as Array<{
              id: string;
              text: string;
              kind: string;
              amount_cents: number | null;
              created_at: string;
            }>).map((r) => ({
              kind: "wins",
              id: r.id,
              snippet: r.text,
              date: r.created_at,
              href: "/wins",
              extra: { subkind: r.kind, amount_cents: r.amount_cents },
            })),
          ),
      );
    }
  }

  if (want.has("reflections")) {
    const base = supabase
      .from("reflections")
      .select("id, text, kind, tags, created_at")
      .eq("user_id", userId);
    const filtered = mode === "q" ? base.ilike("text", pat) : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("created_at", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            text: string;
            kind: string;
            tags: string[];
            created_at: string;
          }>).map((r) => ({
            kind: "reflections",
            id: r.id,
            snippet: r.text,
            date: r.created_at,
            href: "/reflections",
            extra: { subkind: r.kind, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("decisions")) {
    const base = supabase
      .from("decisions")
      .select("id, title, choice, context, tags, created_at, outcome_label")
      .eq("user_id", userId);
    const filtered =
      mode === "q"
        ? base.or(`title.ilike.${pat},choice.ilike.${pat},context.ilike.${pat}`)
        : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("created_at", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            title: string;
            choice: string;
            context: string | null;
            tags: string[];
            created_at: string;
            outcome_label: string | null;
          }>).map((r) => ({
            kind: "decisions",
            id: r.id,
            snippet: `${r.title} → ${r.choice}`,
            date: r.created_at,
            href: "/decisions",
            extra: { title: r.title, outcome_label: r.outcome_label, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("ideas")) {
    const base = supabase
      .from("ideas")
      .select("id, text, kind, heat, status, tags, created_at")
      .eq("user_id", userId);
    const filtered = mode === "q" ? base.ilike("text", pat) : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("created_at", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            text: string;
            kind: string | null;
            heat: number | null;
            status: string | null;
            tags: string[];
            created_at: string;
          }>).map((r) => ({
            kind: "ideas",
            id: r.id,
            snippet: r.text,
            date: r.created_at,
            href: "/ideas",
            extra: { subkind: r.kind, heat: r.heat, status: r.status, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("questions")) {
    const base = supabase
      .from("questions")
      .select("id, text, kind, status, tags, created_at")
      .eq("user_id", userId);
    const filtered = mode === "q" ? base.ilike("text", pat) : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("created_at", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            text: string;
            kind: string | null;
            status: string | null;
            tags: string[];
            created_at: string;
          }>).map((r) => ({
            kind: "questions",
            id: r.id,
            snippet: r.text,
            date: r.created_at,
            href: "/questions",
            extra: { subkind: r.kind, status: r.status, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("knowledge_cards")) {
    const base = supabase
      .from("knowledge_cards")
      .select("id, claim, source, kind, tags, created_at")
      .eq("user_id", userId);
    const filtered =
      mode === "q"
        ? base.or(`claim.ilike.${pat},source.ilike.${pat}`)
        : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("created_at", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            claim: string;
            source: string | null;
            kind: string;
            tags: string[];
            created_at: string;
          }>).map((r) => ({
            kind: "knowledge_cards",
            id: r.id,
            snippet: r.claim,
            date: r.created_at,
            href: "/cards",
            extra: { subkind: r.kind, source: r.source, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("saved_prompts")) {
    const base = supabase
      .from("saved_prompts")
      .select("id, name, body, tags, last_used_at, created_at")
      .eq("user_id", userId);
    const filtered =
      mode === "q"
        ? base.or(`name.ilike.${pat},body.ilike.${pat}`)
        : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            name: string;
            body: string;
            tags: string[];
            last_used_at: string | null;
            created_at: string;
          }>).map((r) => ({
            kind: "saved_prompts",
            id: r.id,
            snippet: `${r.name}: ${r.body.slice(0, 200)}`,
            date: r.last_used_at ?? r.created_at,
            href: "/prompts",
            extra: { name: r.name, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("routines")) {
    const base = supabase
      .from("routines")
      .select("id, name, description, tags, last_used_at, created_at")
      .eq("user_id", userId);
    const filtered =
      mode === "q"
        ? base.or(`name.ilike.${pat},description.ilike.${pat}`)
        : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            name: string;
            description: string | null;
            tags: string[];
            last_used_at: string | null;
            created_at: string;
          }>).map((r) => ({
            kind: "routines",
            id: r.id,
            snippet: r.description ? `${r.name}: ${r.description}` : r.name,
            date: r.last_used_at ?? r.created_at,
            href: "/routines",
            extra: { name: r.name, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("people")) {
    const base = supabase
      .from("people")
      .select("id, name, notes, tags, last_interaction_at, created_at")
      .eq("user_id", userId);
    const filtered =
      mode === "q"
        ? base.or(`name.ilike.${pat},notes.ilike.${pat}`)
        : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("last_interaction_at", { ascending: false, nullsFirst: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            name: string;
            notes: string | null;
            tags: string[];
            last_interaction_at: string | null;
            created_at: string;
          }>).map((r) => ({
            kind: "people",
            id: r.id,
            snippet: r.notes ? `${r.name}: ${r.notes.slice(0, 200)}` : r.name,
            date: r.last_interaction_at ?? r.created_at,
            href: "/people",
            extra: { name: r.name, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("intentions") && mode === "q") {
    promises.push(
      supabase
        .from("intentions")
        .select("id, text, log_date, completed_at")
        .eq("user_id", userId)
        .ilike("text", pat)
        .order("log_date", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            text: string;
            log_date: string;
            completed_at: string | null;
          }>).map((r) => ({
            kind: "intentions",
            id: r.id,
            snippet: r.text,
            date: r.log_date + "T07:00:00.000Z",
            href: "/intentions",
            extra: { completed: r.completed_at != null },
          })),
        ),
    );
  }

  if (want.has("standups") && mode === "q") {
    promises.push(
      supabase
        .from("standups")
        .select("id, yesterday, today, blockers, log_date")
        .eq("user_id", userId)
        .or(`yesterday.ilike.${pat},today.ilike.${pat},blockers.ilike.${pat}`)
        .order("log_date", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            yesterday: string | null;
            today: string | null;
            blockers: string | null;
            log_date: string;
          }>).map((r) => ({
            kind: "standups",
            id: r.id,
            snippet: [r.yesterday, r.today, r.blockers].filter(Boolean).join(" · ").slice(0, 240),
            date: r.log_date + "T08:00:00.000Z",
            href: "/standup",
            extra: {},
          })),
        ),
    );
  }

  if (want.has("reading_list") && mode === "q") {
    promises.push(
      supabase
        .from("reading_list")
        .select("id, title, url, note, summary, read_at, archived_at, saved_at")
        .eq("user_id", userId)
        .or(`title.ilike.${pat},note.ilike.${pat},summary.ilike.${pat},url.ilike.${pat}`)
        .order("saved_at", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            title: string | null;
            url: string;
            note: string | null;
            summary: string | null;
            read_at: string | null;
            archived_at: string | null;
            saved_at: string;
          }>).map((r) => ({
            kind: "reading_list",
            id: r.id,
            snippet: r.title ?? r.url,
            date: r.saved_at,
            href: "/reading",
            extra: {
              url: r.url,
              status: r.archived_at ? "archived" : r.read_at ? "read" : "unread",
            },
          })),
        ),
    );
  }

  if (want.has("themes")) {
    const base = supabase
      .from("themes")
      .select("id, title, kind, status, current_state, description, tags, updated_at")
      .eq("user_id", userId);
    const filtered =
      mode === "q"
        ? base.or(`title.ilike.${pat},description.ilike.${pat},current_state.ilike.${pat}`)
        : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("updated_at", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            title: string;
            kind: string;
            status: string;
            current_state: string | null;
            description: string | null;
            tags: string[];
            updated_at: string;
          }>).map((r) => ({
            kind: "themes",
            id: r.id,
            snippet: r.current_state
              ? `${r.title}: ${r.current_state.slice(0, 200)}`
              : r.description
              ? `${r.title}: ${r.description.slice(0, 200)}`
              : r.title,
            date: r.updated_at,
            href: "/themes",
            extra: { title: r.title, theme_kind: r.kind, status: r.status, tags: r.tags },
          })),
        ),
    );
  }

  if (want.has("policies")) {
    const base = supabase
      .from("policies")
      .select("id, name, rule, category, priority, active, tags, updated_at")
      .eq("user_id", userId);
    const filtered =
      mode === "q"
        ? base.or(`name.ilike.${pat},rule.ilike.${pat},examples.ilike.${pat}`)
        : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("priority", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            name: string;
            rule: string;
            category: string;
            priority: number;
            active: boolean;
            tags: string[];
            updated_at: string;
          }>).map((r) => ({
            kind: "policies",
            id: r.id,
            snippet: `${r.name}: ${r.rule.slice(0, 200)}`,
            date: r.updated_at,
            href: "/policies",
            extra: {
              name: r.name,
              category: r.category,
              priority: r.priority,
              active: r.active,
              tags: r.tags,
            },
          })),
        ),
    );
  }

  if (want.has("predictions")) {
    const base = supabase
      .from("predictions")
      .select("id, claim, confidence, resolve_by, status, category, tags, created_at")
      .eq("user_id", userId);
    const filtered = mode === "q" ? base.ilike("claim", pat) : base.contains("tags", [tag]);
    promises.push(
      filtered
        .order("created_at", { ascending: false })
        .limit(limit)
        .then(({ data }) =>
          ((data ?? []) as Array<{
            id: string;
            claim: string;
            confidence: number;
            resolve_by: string;
            status: string;
            category: string | null;
            tags: string[];
            created_at: string;
          }>).map((r) => ({
            kind: "predictions",
            id: r.id,
            snippet: `${r.claim} (${r.confidence}%)`,
            date: r.created_at,
            href: "/predictions",
            extra: {
              confidence: r.confidence,
              resolve_by: r.resolve_by,
              status: r.status,
              category: r.category,
              tags: r.tags,
            },
          })),
        ),
    );
  }

  const results = await Promise.all(promises);
  const hits: Hit[] = results.flat();
  hits.sort((a, b) => {
    const ta = a.date ? Date.parse(a.date) : 0;
    const tb = b.date ? Date.parse(b.date) : 0;
    return tb - ta;
  });

  return NextResponse.json({ hits, q, tag, count: hits.length });
}
