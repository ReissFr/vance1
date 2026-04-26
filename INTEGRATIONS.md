# JARVIS Integrations Catalogue

A running checklist of real-life APIs we can wire into JARVIS. Tick things off as we build.

**Legend**

- ✅ Free (or free tier sufficient)
- 💰 Paid / requires subscription
- ⚠️ Approval / partner application required
- ❌ No usable public API (browser agent only)

**Status**

- `Not started` — no code, no design
- `Scoped` — design done, provider interface drafted
- `In progress` — code being written
- `Live` — shipped and usable end-to-end

---

## Already covered by the browser agent (don't rebuild as APIs)

The concierge browser agent logs in with Reiss's cookies and drives these as a human would. No need to chase a dedicated API unless we want push notifications or background data pulls.

- Uber (rides + Eats)
- Deliveroo
- Bolt
- Amazon
- OpenTable
- eBay
- AirBnB
- Most e-commerce / forms

The API integrations below are for **data pulls, webhooks, and push events** the browser can't reasonably do.

---

## Already live

| Service | Category | Notes |
|---|---|---|
| Gmail | Email | Inbox triage, drafts, labels |
| Google Calendar | Calendar | Rides on the Gmail OAuth session |
| Stripe | Payments | Read-only revenue |
| SmartThings | Home | Samsung TV wake, device control |
| TrueLayer | Banking | Sandbox only; real data blocked — prefer Monzo |
| Monzo (direct OAuth) | Banking | Transactions + pots; SCA approval in Monzo app required |
| Twilio WhatsApp | Messaging | Bidirectional PA loop |

---

## 💰 Money / Finance

| Service | API | Status | What it unlocks |
|---|---|---|---|
| Monzo (webhooks) | ✅ | Live (OAuth only — webhooks pending) | Real-time push on every transaction. Free. |
| Starling | ✅ | Not started | Same shape as Monzo; UK challenger bank. |
| Revolut Business | ⚠️ | Not started | Requires business account + app approval. |
| Plaid | 💰 ⚠️ | Not started | Multi-bank aggregator. Paid per-connected-account. Only worth it for multi-tenant SaaS. |
| Coinbase | ✅ | In progress | Crypto wallets, balances, portfolio value, transactions (read-only). OAuth + brain tools live; needs `COINBASE_CLIENT_ID`/`SECRET` + run of migration 0029. |
| Kraken | ✅ | In progress | Balances, trades, deposits/withdrawals, staking rewards (read-only). API-key auth (paste in modal); needs migration 0029. Create a Query-Funds + Query-Ledger-Entries key on Kraken — no trade or withdraw perms. |
| Wise | ⚠️ | Not started | FX + multi-currency balances. Approval required. |
| Octopus Energy | ✅ | Not started | Electricity + gas usage, tariff, Agile price feed. UK-specific, free. |
| Bulb / OVO / British Gas | ❌ | — | No public API. |

---

## 🚗 Location / Transport

| Service | API | Status | What it unlocks |
|---|---|---|---|
| TfL Unified API | ✅ | Not started | London tube/bus/rail disruptions, journey planner, live departures. Free, no key needed for basic. |
| Trainline | ❌ | — | No public API — browser agent only. |
| National Rail Darwin / LDBWS | ✅ | Not started | UK train live departures + delays. Free OpenLDBWS key. |
| Citymapper | ❌ | — | Killed their API. |
| Google Maps Platform | 💰 | Not started | Geocoding + directions + places. $200/mo free credit. |
| Mapbox | ✅ | Not started | Free tier generous; same use cases as Google. |
| TomTom Traffic | ✅ | Not started | Live traffic incidents, route ETAs. Free tier. |
| DVLA Vehicle Enquiry | ✅ | Not started | MOT status, tax status from reg plate. Free. |
| DVLA MOT History | ✅ | Not started | MOT test history per vehicle. Free. |
| What3Words | 💰 | Not started | Precise location sharing. Paid beyond 1k/mo. |
| Find My (Apple) | ❌ | — | No API. Shortcuts bridge only. |

---

## 🏃 Health / Fitness

| Service | API | Status | What it unlocks |
|---|---|---|---|
| Apple Health / HealthKit | ❌ | — | No server API. Shortcuts bridge or paid middleware only. |
| Oura Ring | ✅ | Not started | Sleep, readiness, HRV, activity. Free tier. |
| Whoop | ⚠️ | Not started | Recovery, strain. Partner API application. |
| Fitbit | ✅ | Not started | Heart rate, steps, sleep. Free OAuth. |
| Garmin | ⚠️ | Not started | Partner program — slow approval. |
| Strava | ✅ | Not started | Runs, rides, activities. Free OAuth, 15-min rate limit. |
| MyFitnessPal | ❌ | — | API deprecated. |
| Terra | 💰 | Not started | Unified wearable aggregator (Oura + Whoop + Garmin + etc.). Paid. |
| Vital | 💰 | Not started | Same as Terra, HIPAA-first. Paid. |

---

## 🏠 Home / IoT

| Service | API | Status | What it unlocks |
|---|---|---|---|
| SmartThings | ✅ | Live | Samsung TV wake, device state. |
| Philips Hue | ✅ | Not started | Lights. Free local bridge API. |
| LIFX | ✅ | Not started | Lights. Free cloud API. |
| Nest / Google Home | ⚠️ | Not started | Thermostat, cameras. Google Device Access — paid $5 one-time + approval. |
| Ecobee | ✅ | Not started | Thermostat. Free OAuth. |
| Tado | ✅ | Not started | Smart heating. Unofficial API, works well. |
| Ring | ❌ | — | No official public API. |
| Tesla (vehicle + Powerwall) | ⚠️ | Not started | Fleet API now requires app registration + $. |
| Roomba / iRobot | ⚠️ | Not started | Local MQTT or cloud partner. |
| Sonos | ✅ | Not started | Multi-room audio control. Free. |
| Spotify Connect | ✅ | Not started | Playback control (see Media). |
| August / Yale smart locks | ⚠️ | Not started | Partner API. |

---

## 💼 Work / Productivity

| Service | API | Status | What it unlocks |
|---|---|---|---|
| Notion | ✅ | Not started | Pages, databases, blocks. Free OAuth. |
| Linear | ✅ | Not started | Issues, projects. Free OAuth. |
| Slack | ✅ | Not started | Send/read messages, channels. Free OAuth. |
| Discord | ✅ | Not started | Bot or user. Free. |
| GitHub | ✅ | Not started | Repos, issues, PRs, Actions. Free OAuth. |
| Jira | ✅ | Not started | Issues. Free OAuth. |
| Asana | ✅ | Not started | Tasks. Free OAuth. |
| Todoist | ✅ | Not started | Tasks. Free OAuth. |
| Figma | ✅ | Not started | Files, comments. Free OAuth. |
| Google Drive | ✅ | Not started | Files. Already have Gmail OAuth — add scope. |
| Dropbox | ✅ | Not started | Files. Free OAuth. |
| Airtable | ✅ | Not started | Bases. Free personal token. |

---

## 📰 Content / News

| Service | API | Status | What it unlocks |
|---|---|---|---|
| NewsAPI | 💰 | Not started | Headlines aggregator. Free dev tier, paid for production. |
| GNews | ✅ | Not started | Same. 100 req/day free. |
| Guardian Open Platform | ✅ | Not started | Full UK news feed. Free with key. |
| BBC News | ❌ | — | No public API (RSS only). |
| Reddit | ✅ | Not started | Subreddit feeds, post search. Free OAuth (rate-limited). |
| Hacker News | ✅ | Not started | Firebase-backed. Free, no key. |
| Twitter / X | 💰 | Not started | $100/mo minimum. Skip unless required. |
| Product Hunt | ✅ | Not started | Daily launches. Free OAuth. |
| YouTube Data API | ✅ | Not started | Channel uploads, search. Free quota. |
| RSS (generic) | ✅ | Not started | Any blog, podcast, feed. Free forever. |

---

## 🌦️ Environment

| Service | API | Status | What it unlocks |
|---|---|---|---|
| OpenWeatherMap | ✅ | Not started | Current + forecast. Free tier. |
| Met Office DataHub | ✅ | Not started | UK-specific, authoritative. Free tier. |
| Tomorrow.io | ✅ | Not started | Hyperlocal + air quality. Free tier. |
| AirNow / DEFRA | ✅ | Not started | Air quality. Free. |
| Pollen.com | ✅ | Not started | Pollen count. Free. |
| USGS Earthquakes | ✅ | Not started | Global feed. Free. |
| NOAA / Met Office alerts | ✅ | Not started | Severe weather push. Free. |
| PurpleAir | ✅ | Not started | Community air sensors. Free. |

---

## 🏛️ Civic / UK Government

| Service | API | Status | What it unlocks |
|---|---|---|---|
| DVLA MOT History | ✅ | Not started | See Transport. |
| DVLA Vehicle Enquiry | ✅ | Not started | See Transport. |
| Companies House | ✅ | Not started | Company lookup, filings, officers. Free. |
| HMRC Making Tax Digital | ⚠️ | Not started | VAT + self-assessment. Approval required. |
| Land Registry | ✅ | Not started | Property price paid, titles. Free. |
| Parliament / TheyWorkForYou | ✅ | Not started | MPs, votes, Hansard. Free. |
| Police Data UK | ✅ | Not started | Crime by postcode. Free. |
| data.gov.uk (catalog) | ✅ | Not started | Various datasets. Free. |
| Royal Mail Postcode Lookup | 💰 | Not started | Paid — but free alternatives exist (getAddress.io has free tier). |
| Ordnance Survey | ✅ | Not started | Maps, places, addresses. Free tier. |

---

## 🎵 Media

| Service | API | Status | What it unlocks |
|---|---|---|---|
| Spotify | ✅ | Not started | Playback, library, playlists. Free OAuth. |
| Apple Music | ⚠️ | Not started | Developer account $99/yr. |
| Last.fm | ✅ | Not started | Scrobbles, recommendations. Free. |
| Shazam (via RapidAPI) | 💰 | Not started | Song ID. Paid. |
| Letterboxd | ❌ | — | No public API. |
| TMDB (The Movie DB) | ✅ | Not started | Film + TV metadata. Free. |
| IGDB | ✅ | Not started | Video games metadata. Free via Twitch. |

---

## 💳 Money Tools / Commerce

| Service | API | Status | What it unlocks |
|---|---|---|---|
| Stripe | ✅ | Live | Read-only revenue. |
| PayPal | ✅ | Not started | Transactions, balances. Free OAuth. |
| Shopify | ✅ | Not started | Orders, products, inventory. Free OAuth per-store. |
| Square | ✅ | Not started | In-person payments. Free OAuth. |
| Xero | ✅ | Not started | Accounting. Free OAuth. |
| QuickBooks | ✅ | Not started | Accounting. Free OAuth. |
| FreeAgent | ✅ | Not started | UK accounting. Free OAuth. |
| Wise | ⚠️ | Not started | See Money/Finance. |

---

## 🍽️ Restaurants / Food

| Service | API | Status | What it unlocks |
|---|---|---|---|
| OpenTable | ❌ | — | Browser agent only. |
| Resy | ❌ | — | Browser agent only. |
| Deliveroo | ❌ | — | Browser agent only. |
| Uber Eats | ❌ | — | Browser agent only. |
| Yelp Fusion | ✅ | Not started | Place search, reviews. Free tier. |
| Google Places | 💰 | Not started | Place search. Paid via Maps Platform. |
| Foursquare Places | ✅ | Not started | Free tier. |

---

## 🐾 Pets

| Service | API | Status | What it unlocks |
|---|---|---|---|
| PetDesk / Vet portals | ❌ | — | No public API. Browser agent. |
| Whistle / Fi GPS collars | ⚠️ | Not started | Partner API for some products. |
| The Dog API | ✅ | Not started | Breed info. Free. |

---

## Top picks — biggest life-feel unlock per category

If we want "JARVIS knows my whole life" without boiling the ocean, these are the highest-leverage plays:

1. **Monzo webhooks + Octopus + TfL + DVLA MOT** → "your UK life in a briefing"
2. **Oura** (or Whoop) + **Strava** → wellness layer
3. **Notion + Slack + Linear** → work layer
4. **Philips Hue + Tesla + Sonos** → home layer (only if hardware is present)
5. **Guardian + Hacker News + Product Hunt RSS** → content layer (zero cost, big briefing uplift)

---

## Workflow

1. Pick a row, set status to `Scoped`, open the provider doc.
2. Design fits the existing framework pattern — drop into `packages/integrations/src/<category>/`, wire a `*Provider` interface, add a resolver row, surface in `IntegrationsConsole.tsx`, register brain tools in `packages/agent/src/tools/`.
3. Mark `In progress` when code lands, `Live` when end-to-end verified on a real account.
4. If an entry is ❌, delete it — don't keep dead rows around.
