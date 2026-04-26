# Setting up JARVIS (Phase 1)

Everything compiles. Before you can actually run it, you need to create a few
external accounts and paste keys into an env file. This should take ~30 minutes.

## 1 — Anthropic API key

1. Go to https://console.anthropic.com/ and sign in.
2. Settings → API Keys → **Create Key**.
3. Copy it (starts `sk-ant-…`). You'll paste it below.
4. Top up credits — $10 is plenty for weeks of testing.

## 2 — Supabase project

1. Go to https://supabase.com/dashboard → **New project**.
2. Name: `jarvis`. **Region: London (eu-west-2)** — this matters for GDPR and latency.
3. Set a strong database password (save it in your password manager).
4. Wait ~2 minutes for the project to spin up.
5. Once ready, grab three values from **Project Settings**:
   - `Project URL` (Settings → API) → goes into `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key (Settings → API) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key (Settings → API, click "Reveal") → `SUPABASE_SERVICE_ROLE_KEY`
6. **Run the migration** — Settings → SQL Editor → New query → paste the contents of
   `supabase/migrations/0001_core.sql` → **Run**. This creates all the tables,
   RLS policies, and semantic search function.

## 3 — Google Cloud OAuth (for Gmail + Calendar)

This is the fiddliest bit. Take your time.

1. Go to https://console.cloud.google.com/ → create a new project called `jarvis-dev`.
2. **Enable APIs**: APIs & Services → Enable APIs → enable **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen**:
   - User type: **External** (required for personal Google accounts).
   - App name: `JARVIS (dev)`.
   - Support + developer email: your own.
   - Scopes: add `.../auth/gmail.modify` and `.../auth/calendar.events`.
   - Test users: add your own Gmail address (without this, auth will fail in dev).
4. **Create OAuth client**:
   - Credentials → Create Credentials → OAuth client ID → **Web application**.
   - Authorised redirect URIs — add **both**:
     - `http://localhost:3000/auth/callback`
     - `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
   - Copy the **Client ID** and **Client Secret** → `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
5. **Plug into Supabase**:
   - Supabase dashboard → Authentication → Providers → **Google** → enable.
   - Paste the Client ID + Secret.
   - Save.

> You'll need to submit this OAuth app for Google verification before you have
> >100 users or ship publicly. That takes 4–6 weeks, so start the process as
> soon as you want to open up sign-ups. Not blocking for just you right now.

## 4 — Voyage API key (for semantic memory)

1. Go to https://www.voyageai.com/ → sign up.
2. Dashboard → API Keys → create one.
3. Paste it into `VOYAGE_API_KEY`. Free tier is more than enough for development.

## 5 — Create your local env file

```bash
cd ~/jarvis
cp .env.example apps/web/.env.local
open -e apps/web/.env.local   # opens in TextEdit
```

Fill in every `=` that's currently blank, from the steps above. Leave the voice
ones (ElevenLabs, Deepgram, Groq, Picovoice) empty for now — Phase 2.

## 6 — Run it

```bash
cd ~/jarvis
pnpm dev
```

Open http://localhost:3000 → sign in with Google → try:

- `"Summarise my unread emails."`
- `"Remember I prefer meetings after 10am."`
- `"What's on my calendar tomorrow?"`

If something breaks, the terminal running `pnpm dev` has the error. Paste it back
to me and we'll debug.

## What's next

Once Phase 1 works end-to-end, we move to:

- Phase 2: wake word + voice in/out on the web.
- Phase 3: Tauri Mac app with face recognition and "Open Google" / device control.

See `~/.claude/plans/mellow-noodling-cherny.md` for the full roadmap.
