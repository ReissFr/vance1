import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { listRecentSegments } from "@/lib/meetings";

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("meeting_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) redirect("/meetings");

  const segments = await listRecentSegments(supabase, id, 1000);
  const started = new Date(session.started_at);
  const ended = session.ended_at ? new Date(session.ended_at) : null;
  const duration = ended ? Math.round((ended.getTime() - started.getTime()) / 60000) : null;
  const hasTranslation = segments.some((s) => s.original_text);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6 flex items-center justify-between">
          <Link href="/meetings" className="text-xs text-white/60 hover:text-white/90">
            ← meetings
          </Link>
          <div className="text-xs text-white/40">
            {started.toLocaleString()}
            {duration != null && ` · ${duration} min`}
            {session.detected_language && session.detected_language !== "en" && (
              <span className="ml-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
                {session.detected_language.toUpperCase()} → EN
              </span>
            )}
          </div>
        </header>

        <h1 className="text-2xl font-semibold">{session.title ?? "(untitled)"}</h1>

        {session.summary && (
          <section className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-white/40">Summary</div>
            <pre className="whitespace-pre-wrap text-sm text-white/80">{session.summary}</pre>
          </section>
        )}

        {session.action_items && (
          <section className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-white/40">Action items</div>
            <pre className="whitespace-pre-wrap text-sm text-white/80">{session.action_items}</pre>
          </section>
        )}

        <section className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-white/40">
              Transcript{hasTranslation ? " (English)" : ""}
            </div>
            {hasTranslation && (
              <div className="text-[11px] text-white/40">
                Original shown below each line
              </div>
            )}
          </div>
          {segments.length === 0 ? (
            <div className="text-sm text-white/40">No transcript captured.</div>
          ) : hasTranslation ? (
            <div className="space-y-3 text-sm leading-relaxed">
              {segments.map((s) => (
                <div key={s.id}>
                  <div className="text-white/80">{s.text}</div>
                  {s.original_text && (
                    <div className="mt-0.5 text-[12px] italic text-white/40">
                      {s.language ? `${s.language}: ` : ""}
                      {s.original_text}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm leading-relaxed text-white/70">
              {segments.map((s) => (
                <span key={s.id}>{s.text} </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
