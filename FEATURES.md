# JARVIS — Autopilot Features Built

Every feature shipped during the autopilot sessions starting 2026-04-24. Each is end-to-end: migration + API + page + console + brain tools + palette wiring.

---

## Foundation (§1 – §28)

1. Linear + Todoist + Resend + Plaid + Google Drive integrations
2. First-run onboarding wizard
3. `/today` dashboard (at-a-glance board)
4. `/memory` — long-term memory viewer + editor
5. `/automations` console
6. `/skills` console
7. Receipts inbox (one-off purchase tracker)
8. Evening wrap-up + weekly review agents
9. Commitments tracker
10. Conversation history console
11. Mobile responsive pass (shell + history)
12. Error monitoring (self-hosted + optional Sentry mirror)
13. Product analytics (self-hosted + optional PostHog mirror)
14. Slack integration — `/jarvis` slash command + app mentions
15. Telegram bot
16. Budget alerts (monthly category caps + breach notifications)
17. LLM cost dashboard (`/costs`)
18. Settings page — real preferences hub
19. Places console — geofence wiring + mobile + nearest-place
20. Subscriptions page (`/subscriptions`)
21. Run-now triggers for scheduled agents
22. Operations board ApprovalCard CTA wiring
23. Command palette expansion
24. Chat `?q=` prefill + action palette hookup
25. Global single-key shortcuts + `?` help overlay
26. CSV export + search on Receipts & Subscriptions
27. Global Operations badge (pending-approval count in NavRail)
28. Evening wrap + Weekly review web views

## Daily-driver polish (§29 – §83)

§29. CSV export on Budgets + Commitments
§30. Today dashboard: "What JARVIS did today" activity timeline
§31. /history honors `?task=<id>` deep-links
§32. Morning briefing archive strip
§33. Global task notifier (toasts from any page)
§34. Quick-capture FAB + ⌘J + palette entry
§35. NavRail badges: desktop fix + running-task live dot
§36. Commitments-due-today on Today board
§37. Morning briefing now surfaces overdue / due-today commitments
§38. "Coming up today" card on /today (scheduled tasks firing later)
§39. Cancel-scheduled-task inline on /today's "Coming up" card
§40. Text search on /memory
§41. Archive strip on /evening-wrap and /weekly-review
§42. Retry failed tasks inline on the Today activity timeline
§43. Per-task cost display on the Today activity timeline
§44. Export conversation as markdown from /history
§45. Conversation cost + task-count on /history list
§46. Snooze buttons on scheduled tasks
§47. RETRY action on /operations activity rail
§48. Bulk actions on /commitments
§49. Agent performance section on /costs
§50. Integration health banner on /today
§51. Global cross-entity search at /search
§52. /commitments ?id= deep-link + scroll-to
§53. JSON export + prettier tool-result rendering for conversations
§54. Deep-link focus generalised (Subs / Receipts / Memory)
§55. /insights week-over-week dashboard
§56. Spending heatmap on /insights
§57. Stale commitments badge + Overdue filter
§58. Overdue commitment quick actions (NUDGE + +7D)
§59. Inline category edit on receipt rows
§60. "Cancel for me" on subscriptions (agentic, not data-only)
§61. Budget suggestion from last 90 days of receipts
§62. HeadsUpBanner on /today (stale commitments + recent failed tasks)
§63. Bulk retry for failed tasks
§64. Auto-categorize uncategorized receipts
§65. Live actions in the command palette
§66. Budget breaches in the heads-up banner
§67. Budget → receipts drill-down
§68. Test-fire automations + recent-run dot strip
§69. Top merchants strip on /receipts
§70. Spend-trajectory forecast on budgets
§71. Direct cancel-page links for common subscriptions
§72. Stale subscription detection
§73. Receipts: potential duplicate detection
§74. Memory pinning: always-in-context facts
§75. Automations weekly activity header
§76. /money — consolidated waste dashboard
§77. Proactive mute: temporary snooze
§78. Per-user quiet hours
§79. /today Money signal in HeadsUpBanner
§80. NavRail badges for budgets / money / memory
§81. Automation run detail (inline expansion)
§82. Brain tools: snooze_proactive + clear_proactive_snooze
§83. Automation duplicate guard on create

## Calendar / contacts / commitments depth (§84 – §97)

§84. Meeting Ghost → commitments auto-extract
§85. Proactive commitment nudges
§86. Commitments in evening wrap + weekly review
§87. Calendar event prep brief (PREP button on /today)
§88. Pre-meeting proactive ping (prep-enriched calendar signal)
§89. Stalled-approval nudges in the proactive loop
§90. Contact profile page (/contacts?email=…)
§91. Brain tool: lookup_contact
§92. Contacts index page
§93. Contacts in nav + shortcuts + palette
§94. Manual commitment quick-add
§95. Auto-close outbound commitments from sent mail
§96. Nudge button on contact profile
§97. iCal feed for open commitments

## Self-knowledge journal layers (§98 – §131)

§98. Habits tracker
§99. Brain tools for habits
§100. Proactive nudges for missed daily habits
§101. Focus mode timer page
§102. Focus session log + weekly deep-work stats
§103. Reading list (read-later with auto-summary)
§104. Daily check-ins (energy / mood / focus)
§105. Daily intentions (one thing for today)
§106. Decision log (founder-grade)
§107. Birthdays & important dates
§108. Auto-fire birthday nudges (cron)
§109. Wins log
§110. Goals (quarterly objectives the rest ladders up to)
§111. Idea inbox (shower thoughts and what-ifs)
§112. Question log (open loops that compound)
§113. Weekly digest (Sunday-evening synthesis of all the journal logs)
§114. Wire the new logs into the morning briefing
§115. Wire the new logs into the evening wrap
§116. Reflections journal (the retrospective layer)
§117. Wire reflections into the briefing, evening wrap, and weekly digest
§118. Open-loops dashboard at /loops
§119. Saved prompts library (fire-by-name templates)
§120. People CRM lite
§121. Knowledge cards
§122. Brand voice (writer-agent voice config)
§123. Standup log (yesterday/today/blockers daily entry)
§124. Routines (named ordered checklists)
§125. Retrospective (cross-journal synthesis)
§126. Cross-search brain tool
§127. `lookup_tag` brain tool
§128. Themes (narrative threads)
§129. Policies (rules the brain enforces)
§130. Predictions (calibration log)
§131. Universal search across every journal layer

## Inner-architecture surfaces (§132 – §150)

§132. Reality Reconciliation (said-vs-did drift detector)
§133. Inner monologue (Haiku-grounded observations the brain has noticed about you)
§134. Decision pre-mortems (Haiku-generated failure modes the user watches over time)
§135. Counterfactual replays (the path not taken, generated and inspected)
§136. Trajectory Projection (where you land if you don't change course)
§137. Identity Graph (who you are in your own words, drift tracked)
§138. Future-Self Dialogue (chat with you from 6, 12 or 60 months from now)
§139. Living Constitution (your own laws, distilled and versioned)
§140. Past-Self Dialogue (talk to you-from-3/6/12/24/36-months-ago)
§141. Belief vs Behaviour (the integrity audit)
§142. Inner Council (six voices of yourself, in parallel)
§143. Echo Journal (semantic-conceptual recall of "you've been here before")
§144. Self-Mirror Stream (third-person snapshots of who you appear to be, with drift)
§145. Decision Postmortem Loop (auto-scheduled "did this play out?" check-ins)
§146. Soul Cartography (visual graph of the user's inner architecture, with drift over time)
§147. Pre-Write (invert the blank-page friction with voice-mirroring drafts)
§148. Energy Forecast (predictive self-model with calibration)
§149. Life Timeline (auto-detected chapters from your journal stream)
§150. Time Letters (messages across time, with novel past-self generator)

## Reflective ledgers — the self-knowledge core (§151 – §180)

§151. Latent Decision Detector (the dark matter of self-knowledge)
§152. Reverse Brief (archaeology of belief from action)
§153. Counter-Self Chamber (the strongest possible adversary against your position)
§154. Pattern Library (causal patterns in your own data)
§155. Conversation Loop Detector (mining your own messages)
§156. The Promise Ledger (self-trust audit)
§157. Inner Voice Atlas
§158. Phantom Limb Detector (move-on claims that never stuck)
§159. Pivot Map (the moments you turned, and whether you actually turned)
§160. Question Graveyard
§161. The Mirror Index
§162. The Permission Ledger
§163. The Self-Erasure Register
§164. The Disowned Register
§165. The Used-To Register
§166. The Should Ledger
§167. The Voice Cabinet
§168. Mind Theatre
§169. The Threshold Ledger
§170. The Almost-Register
§171. GROOVE & RUT INDEX (the self-report grain of recurrence)
§172. THE VOW LEDGER (constitutional review of the self)
§173. LETTERS ACROSS TIME (the epistolary archive)
§174. THE LOOPS REGISTER (recurring concerns mining + four resolutions)
§175. SAID-I-WOULD LEDGER (chat-mined self-promises with mode-specific resolutions)
§176. CONTRADICTIONS LEDGER (Haiku-mined direct internal conflicts in your own words)
§177. PERMISSION SLIPS (the explicit self-license register)
§178. OWED-TO-ME LEDGER (promises others made to you, with relationship cross-tab)
§179. GUT-CHECK LEDGER (the felt-signal mirror to articulated thought)
§180. FEAR LEDGER (the empirical inner alarm system, half two)

---

**Total features shipped:** 180

Detailed architecture for each feature lives in [SESSION_SUMMARY.md](SESSION_SUMMARY.md). Deploy steps and migration list live in [AUTOPILOT_TODO_FOR_REISS.md](AUTOPILOT_TODO_FOR_REISS.md).
