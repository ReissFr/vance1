# JARVIS features shipped today — 2026-04-24

64 features across one autopilot window. All typechecks clean; no commits (no git repo). Migrations 0022–0047 pending deploy; env-var + OAuth checklist in `AUTOPILOT_TODO_FOR_REISS.md`; full per-feature detail in `SESSION_SUMMARY.md`.

| # | Feature |
|---|---------|
| 29 | CSV export on Budgets + Commitments |
| 30 | Today dashboard: "What JARVIS did today" activity timeline |
| 31 | /history honors `?task=<id>` deep-links |
| 32 | Morning briefing archive strip |
| 33 | Global task notifier (toasts from any page) |
| 34 | Quick-capture FAB + ⌘J + palette entry |
| 35 | NavRail badges: desktop fix + running-task live dot |
| 36 | Commitments-due-today on Today board |
| 37 | Morning briefing surfaces overdue / due-today commitments |
| 38 | "Coming up today" card on /today |
| 39 | Cancel-scheduled-task inline on /today's "Coming up" card |
| 40 | Text search on /memory |
| 41 | Archive strip on /evening-wrap and /weekly-review |
| 42 | Retry failed tasks inline on the Today activity timeline |
| 43 | Per-task cost display on the Today activity timeline |
| 44 | Export conversation as markdown from /history |
| 45 | Conversation cost + task-count on /history list |
| 46 | Snooze buttons on scheduled tasks |
| 47 | RETRY action on /operations activity rail |
| 48 | Bulk actions on /commitments |
| 49 | Agent performance section on /costs |
| 50 | Integration health banner on /today |
| 51 | Global cross-entity search at /search |
| 52 | /commitments `?id=` deep-link + scroll-to |
| 53 | JSON export + prettier tool-result rendering for conversations |
| 54 | Deep-link focus generalised (Subs / Receipts / Memory) |
| 55 | /insights week-over-week dashboard |
| 56 | Spending heatmap on /insights |
| 57 | Stale commitments badge + Overdue filter |
| 58 | Overdue commitment quick actions (NUDGE + +7D) |
| 59 | Inline category edit on receipt rows |
| 60 | "Cancel for me" on subscriptions (agentic, not data-only) |
| 61 | Budget suggestion from last 90 days of receipts |
| 62 | HeadsUpBanner on /today (stale commitments + recent failed tasks) |
| 63 | Bulk retry for failed tasks |
| 64 | Auto-categorize uncategorized receipts |
| 65 | Live actions in the command palette |
| 66 | Budget breaches in the heads-up banner |
| 67 | Budget → receipts drill-down |
| 68 | Test-fire automations + recent-run dot strip |
| 69 | Top merchants strip on /receipts |
| 70 | Spend-trajectory forecast on budgets |
| 71 | Direct cancel-page links for common subscriptions |
| 72 | Stale subscription detection |
| 73 | Receipts: potential duplicate detection |
| 74 | Memory pinning: always-in-context facts |
| 75 | Automations weekly activity header |
| 76 | /money — consolidated waste dashboard |
| 76a | /money command-palette entry |
| 77 | Proactive mute: temporary snooze |
| 78 | Per-user quiet hours |
| 79 | /today Money signal in HeadsUpBanner |
| 80 | NavRail badges for budgets / money / memory |
| 81 | Automation run detail (inline expansion) |
| 82 | Brain tools: snooze_proactive + clear_proactive_snooze |
| 83 | Automation duplicate guard on create |
| 84 | Meeting Ghost → commitments auto-extract |
| 85 | Proactive commitment nudges |
| 86 | Commitments in evening wrap + weekly review |
| 87 | Calendar event prep brief (PREP button on /today) |
| 88 | Pre-meeting proactive ping (prep-enriched calendar signal) |
| 89 | Stalled-approval nudges in the proactive loop |
| 90 | Contact profile page (`/contacts?email=…`) |
| 91 | Brain tool: lookup_contact |

## Themes

- **Commitments / promise tracking** (8 features): §36, §37, §48, §52, §57, §58, §84, §85, §86 — extract from email AND meetings, nudge via proactive, roll into briefing / evening wrap / weekly review.
- **Financial hygiene** (13 features): §29, §49, §55, §56, §59, §60, §61, §67, §69, §70, §72, §73, §76, §79 — receipts auto-categorise, subscriptions cancel-for-me, budgets forecast + breach, consolidated /money waste dashboard.
- **Today dashboard** (11 features): §30, §33, §34, §35, §36, §38, §50, §62, §66, §79, §80 — live activity timeline, heads-up banner, quick capture, nav badges, integration health.
- **Calendar / meetings** (4 features): §84, §87, §88, §91 — meeting-ghost commitment extraction, PREP button, 15-min-before proactive ping, contact-briefing brain tool.
- **Proactive layer** (7 features): §62, §74, §77, §78, §82, §85, §88, §89 — heads-up signals, memory pinning, snooze, quiet hours, calendar prep, stalled-draft reminders.
- **Agent / brain tools** (4 features): §60, §64, §82, §91 — agentic subscription cancellation, auto-categorisation, snooze-proactive, lookup_contact.

## Deferred / needs you back

- `jarvis/` has no git repo → no commits made. Run `git init && git add . && git commit` when back.
- 5 migrations pending deploy: 0043, 0044, 0045, 0046, 0047. Full list in `AUTOPILOT_TODO_FOR_REISS.md`.
- 4 cron schedules to wire (briefings, evening wraps, weekly reviews, budget checks).
- OAuth app registrations for Linear, Todoist, Plaid, Google Drive, Telegram bot.
