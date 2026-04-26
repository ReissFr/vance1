smoke test
# JARVIS (codename)

Reiss's multi-device personal AI assistant. Cloud brain, thin clients on Mac/iPhone/web.

> The name "JARVIS" is a Marvel/Disney trademark — this is the internal codename only.
> Pick a real product name before public launch.

## Stack

- **Brain**: Anthropic Claude (Haiku 4.5 default → Sonnet 4.6 escalation → Opus 4.6 premium) via Claude Agent SDK.
- **Backend**: Supabase (Postgres + pgvector + Auth + Realtime).
- **Web**: Next.js 15 on Netlify.
- **Desktop** (Phase 3): Tauri 2.
- **Mobile** (Phase 4): Expo / React Native.
- **Voice**: Picovoice Porcupine (wake) · Groq Whisper (STT) · ElevenLabs / OpenAI TTS.

Full design doc: `~/.claude/plans/mellow-noodling-cherny.md`.

## Layout

```
apps/
  web/        Next.js — primary UI + API routes
  desktop/    Tauri (Phase 3)
  mobile/     Expo (Phase 4)
packages/
  agent/      Claude Agent SDK brain, shared across apps
  types/      Shared TypeScript types
supabase/
  migrations/ Database schema
  functions/  Edge functions (proactive jobs, webhooks)
```

## Getting started

```bash
# 1. Install deps
pnpm install

# 2. Copy env template and fill in
cp .env.example apps/web/.env.local

# 3. Run the web app
pnpm dev
```

## Phase tracker

- [ ] Phase 0 — Foundations (this commit)
- [ ] Phase 1 — Brain: text chat + Gmail + Calendar + memory
- [ ] Phase 2 — Voice: wake word + STT + TTS on web
- [ ] Phase 3 — Mac desktop (Tauri) + face rec + device control
- [ ] Phase 4 — iPhone (Expo)
- [ ] Phase 5 — Smart home, WhatsApp, SevenPoint AI integrations
hello four
