# JARVIS Roadmap

Product positioning, pricing tiers, and sequenced build plan.
Last updated: 2026-04-22

---

## 1. Product positioning

**One-liner:** Your PA in a text message. Call it, text it, forget about it.

**Wedge pitch:** *"Replaces your £400/mo AI + admin stack for £39."*

JARVIS is not a chatbot. It's a personal assistant with:
- Its own phone number (every user gets one)
- Proactive initiative (pings you when things matter)
- Autonomous background workers (inbox, research, writing, calls, errands)
- Memory that compounds
- Voice in and out (you can literally ring your PA)

Competes with both software (Superhuman, Motion, Granola, Zapier, ChatGPT) and human services (virtual assistants, household concierges, executive assistants).

---

## 2. Pricing tiers

| Tier | Price | Who it's for | Headline |
|---|---|---|---|
| **Free** | £0/mo | Trial funnel | "Text the JARVIS number — see what it can do" |
| **Personal** | £19/mo | Busy individual | "Your own PA number. Unlimited text. Replaces £50+ of tools." |
| **Pro** | £39/mo | Professionals, founders | "Replaces Superhuman + Motion + Granola + Zapier + ChatGPT. Plus voice." |
| **Executive** | £79/mo | Power users, real-PA replacers | "Replaces your entire AI + admin stack — and your VA." |
| **Team** *(future)* | £299+/mo | Small biz, family offices | "JARVIS for the whole org" |

### What's in each tier

**Free**
- Shared JARVIS number (routed by From:)
- 50 msgs / month
- 1 integration
- No proactive, no workers, no voice

**Personal (£19)**
- Own SMS number
- Unlimited text
- Proactive pings + quiet hours
- Morning briefing
- Memory (persistent)
- 3 integrations (email, calendar, payments OR smart home)

**Pro (£39)** — *the sweet spot*
- Everything in Personal
- Voice in + out (15 min/mo)
- All background workers (inbox_agent, researcher, writer, outreach, ops, code)
- Meeting ghost (audio → summary)
- Skills ecosystem
- All integrations
- Browser agent (30 min/mo)

**Executive (£79)**
- Everything in Pro
- Unlimited voice
- Unlimited browser agent
- Earpiece coach (live)
- Meeting-as-me *(future)*
- Open-loops external chasing
- Priority queue
- Custom skills
- 2 seats

**Team (£299+, future)**
- Multi-user under one subscription
- Shared memory / org context
- SSO
- Admin integrations (Google Workspace)
- Concierge onboarding

---

## 3. Current state (as of 2026-04-22)

🟢 Shipped | 🟡 Partial | 🔴 Not built

### Messaging
- 🟢 WhatsApp (Twilio sandbox — dev only, will migrate)
- 🔴 Per-user SMS numbers (Twilio provisioning) — **NEXT BUILD**
- 🔴 Per-user inbound voice
- 🔴 Realtime voice conversation

### Brain & agents
- 🟢 Haiku-first brain with tools
- 🟢 Cost layer (caches, distillation, prompt caching) — migrations 0021/0022
- 🟢 Memory (semantic recall + recency + auto-extraction)
- 🟢 Proactive judgment loop — migration 0027
- 🟢 Background workers: code, researcher, writer, outreach, inbox, ops
- 🟢 Meeting ghost + earpiece coach
- 🟢 Morning briefing (07:00)
- 🟢 Skills ecosystem (find/install/load/exec)
- 🟢 Browser agent (persistent Chromium profile)
- 🟢 Cloud browser scaffold (Fly + Dockerfile, migration 0026)

### Integrations framework
- 🟢 EmailProvider + GmailProvider
- 🟢 PaymentProvider + StripeProvider (read-only)
- 🟢 SmartHomeProvider + SmartThingsProvider
- 🟡 CalendarProvider (not abstracted — legacy profiles.google_*)

### SaaS plumbing
- 🔴 `plans` table + tier column
- 🔴 Stripe billing (Checkout + subscription webhooks)
- 🔴 Usage metering (msgs, voice min, browser min)
- 🔴 Quota enforcement
- 🔴 Number reclamation cron

### Deployment gaps
- 🔴 Cron scheduler wiring (run-proactive, run-briefings not called)
- 🔴 Production Twilio sender (currently sandbox, 63015 errors)
- 🔴 Several migrations pending deploy (0021, 0022, 0026, 0027)

---

## 4. Roadmap — what's still needed per tier

### To ship Personal (£19)
1. **Per-user phone numbers** (migration + provisioning helper + notify.ts refactor + inbound routing by To:)
2. **Stripe billing** (PaymentProvider write-side, Checkout, subscription webhooks)
3. **`plans` table** + tier/quota columns on profiles
4. **Basic usage metering** (msgs counter per billing period)
5. **Quota enforcement** (block sending when out, upgrade nudge)
6. **Cron scheduler** wired to hit run-proactive + run-briefings
7. **Production Twilio sender** (Meta/carrier approval for per-user numbers)

### To ship Pro (£39)
1. Everything in Personal, plus:
2. **Voice inbound webhook** (user calls their number → routes to JARVIS)
3. **Realtime voice** (Twilio Media Streams → Anthropic voice or Deepgram+ElevenLabs)
4. **Voice outbound** (already have call_agent — just expose in tier)
5. **Voice minutes metering**
6. **Browser agent quota metering** (Fly machine minutes tracked)
7. **Meeting ghost** (already built — just tier-gate)

### To ship Executive (£79)
1. Everything in Pro, plus:
2. **Unlimited flags** on quotas (soft caps for abuse)
3. **Priority queue** (Redis or Supabase queue with priority column)
4. **Open-loops table** + tracker (commitments, "chase Dan if he hasn't replied")
5. **Live earpiece coach** (already partly built — needs polish)
6. **Custom skills UI** (skill-builder agent)
7. **Meeting-as-me** (new — AI joins Zoom, acts as the user)
8. **Seat management** (up to 2 users on one account)

### To ship Team (£299+, much later)
1. Multi-tenant org model
2. SSO (Google/Microsoft/Okta)
3. Admin panel
4. Shared memory scoping rules
5. Concierge onboarding flow

---

## 5. 🔴 Feature gaps that expand the "replaces X" pitch

Ranked by marketing punch × build effort.

### Build first (strongest landing-page bullets)
1. **Subscription tracker / killer** — scans email + payments for recurrings, proposes cancels. Massive "paid for itself" moment. *Replaces Rocket Money.*
2. **Receipts → expenses** — photo → Claude vision → parse → store. Strong for freelancers/founders. *Replaces Expensify £10/mo.*
3. **Package tracking proactive** — parses shipping emails → proactive "arrives today" pings. *Replaces Shop/Aftership.*
4. **Meeting prep agent** — 30 min before meeting, DMs you a brief (who, last convo, open items). Extends meeting ghost.
5. **UK self-assessment helper** 🔥 — categorise income/expenses → Making Tax Digital ready. **Massive UK moat. No AI PA touches this. Anchors Executive tier.** *Replaces FreeAgent £14, Xero £29, accountant £800/yr.*
6. **Travel brain** — glues browser + memory + proactive for plan+book+nudge. *Replaces TripIt + travel agent.*
7. **Local concierge** — "book a haircut near Shoreditch tomorrow 5pm" — glues voice + browser. *Replaces AmEx concierge.*

### Build later
8. Doc signing (DocuSign killer)
9. Job search agent (CV + apply)
10. Fitness nudges + booking
11. Photo shoebox (send anything)
12. Real estate alerts (Rightmove/Zoopla)
13. Translation inline
14. Image gen/edit (Pix MCP wrapper)

### Premium-only (Executive £79 moat)
- Meeting-as-me
- Always-on coach (live earpiece)
- Rewind-log
- Family/team seats

---

## 6. Build order — sequenced

### Phase 1: "Feels alive" (current)
- ✅ Proactive judgment loop
- ✅ Memory auto-extraction
- ✅ Recency-biased memory recall

### Phase 2: "Per-user phone number" (NEXT — ~1 week)
- [ ] Migration: `user_phone_numbers` table
- [ ] Twilio provisioning helper (buy + configure webhooks)
- [ ] Signup hook → provision number → welcome SMS
- [ ] `notify.ts` refactor: send from user's number
- [ ] Inbound SMS webhook routes by To: → user_id
- [ ] Voice webhook (start with voicemail + transcribe → text back)
- [ ] Production Twilio sender setup (carrier/Meta approval)

### Phase 3: "SaaS plumbing" (~1 week)
- [ ] `plans` table + tier/quota columns
- [ ] Stripe Checkout + subscription webhooks
- [ ] Subscription.active → provision number; canceled → release
- [ ] Usage metering (msgs, voice_min, browser_min)
- [ ] Quota enforcement + upgrade nudges
- [ ] Cron scheduler (Supabase pg_cron hitting /api/cron/*)
- [ ] Number reclamation cron (30-day inactive)

### Phase 4: "Voice is real" (~1 week)
- [ ] Realtime voice via Twilio Media Streams + Anthropic voice
- [ ] "Call your PA" landing moment — shareable demo
- [ ] Voice-minute quota wired to tier

### Phase 5: "Open loops" (3rd pillar of original plan)
- [ ] `open_loops` table
- [ ] Poller feeds overdue loops into proactive judge
- [ ] "Chase Dan if not replied by Friday" UX

### Phase 6: "Replace-£X features" — in marketing order
1. Subscription tracker
2. Receipts → expenses
3. Package tracking proactive
4. Meeting prep agent
5. UK self-assessment helper 🔥
6. Travel brain
7. Local concierge

### Phase 7: Team + future
- Multi-tenant org model
- Team tier billing
- SSO
- Meeting-as-me

---

## 7. Unit economics per tier (rough)

Assumes cost layer (caches) doing its job.

| Tier | Price | Twilio | Anthropic | Infra | Stripe | COGS | Margin |
|---|---|---|---|---|---|---|---|
| Free | £0 | £0.30 | £1 | £0.50 | £0 | £1.80 | -£1.80 (funnel cost) |
| Personal | £19 | £2 | £4 | £1 | £0.57 | £7.57 | £11.43 (60%) |
| Pro | £39 | £8 | £7 | £2 | £1.17 | £18.17 | £20.83 (53%) |
| Executive | £79 | £25 | £12 | £5 | £2.37 | £44.37 | £34.63 (44%) |

**Targets**: blended gross margin 55–65% across mix. Executive power users thin — acceptable because Pro tier carries the weight.

**Free tier loss** is the funnel. Offset by limiting to 50 msgs/mo + 1 integration so even the heaviest Free user costs < £3.

---

## 8. Marketing lines (ready-to-use)

**Homepage hero:**
> *"Cancel your entire AI stack. Hire JARVIS for £39/mo."*

**Sub-hero:**
> *"Text it. Call it. Forget about it. Your PA has its own number."*

**Tier anchors for the pricing page:**
- Personal: *"Replaces ChatGPT + Sanebox + Calendly (£54 stack)"*
- Pro: *"Replaces Superhuman + Motion + Granola + Zapier + ChatGPT + Perplexity (£150+ stack)"*
- Executive: *"Replaces your AI stack and your virtual assistant (£400+ stack + human time)"*

**Feature narratives (per 🔴 build):**
- Subscription tracker: *"JARVIS finds the subs you forgot. It usually pays for itself in week one."*
- UK tax: *"Self-assessment in chat. No spreadsheets. No £800 accountant bills."*
- Voice: *"Pull up. Call your PA on the motorway."*
- Meeting prep: *"Five minutes before your next meeting, JARVIS texts you everything you need to know."*

---

## 9. Open questions / decisions to lock

- [ ] SMS primary (green bubble) — ✅ confirmed
- [ ] WhatsApp as optional upgrade per user? Or drop?
- [ ] Voice realtime shape: Anthropic voice (when GA) vs Deepgram + Claude text + ElevenLabs
- [ ] Free tier limits — 50 msgs, 1 integration, no proactive. Tighten or loosen?
- [ ] Launch pricing discount? (e.g. Pro at £29 launch → £39 after first 500 users)
- [ ] Annual billing discount (~2 months free) — yes probably
- [ ] Whether to do a referral credit system (give £5 JARVIS credit per referral)
