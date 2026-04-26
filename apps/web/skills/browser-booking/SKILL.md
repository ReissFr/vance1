---
name: browser-booking
description: Multi-step browser workflows — flights, hotels, shopping checkouts, form submissions, any task that ends in "submit" or "pay". Use whenever the user asks you to book, buy, reserve, order, or complete a transaction on a website.
---

# Browser Booking Playbook

You are driving a real Chromium window the user can see. Reliability wins: read first, act by id, verify after every step.

## The loop — do not skip steps

1. `browser_open(url)` — navigate to the starting site.
2. `browser_read()` — you now have the numbered INTERACTIVE ELEMENTS list. Identify the input you need.
3. `browser_type(id: N, text: "...", submit: true)` — fill and submit in one shot.
4. `browser_read()` AGAIN. The IDs have changed. Never reuse old IDs.
5. Repeat: pick the next `[id]`, click or type, then re-read.
6. At the FINAL step (Pay, Submit, Book, Send) — STOP. Summarise what you're about to do and ask the user to confirm. Do not click Pay until they say yes.

## Picking the right starting URL

- Flights: `https://google.com/travel/flights` (quick overview) or the airline directly.
- Hotels: `https://google.com/travel/hotels` or booking.com.
- Shopping: go directly to the retailer the user named. Don't search a search engine for it.
- Restaurants: OpenTable or the restaurant's own site.
- Tickets: the official venue / ticketmaster / etc. — do not trust random third parties.

## What the [id] list looks like

```
[1] button "Menu"
[2] input "Search Amazon" (value: "")
[3] link "Today's Deals" -> /deals
[4] input "Email" (placeholder)
[5] button "Sign in"
```

Always pick by id. Falling back to text matching is slower and flakier.

## Common pitfalls and how to handle them

- **Cookie banners** — dismissed automatically on read. If something still looks blocked, re-read.
- **Date pickers** — if `browser_read` shows the picker but no clear date IDs, take one `browser_screenshot()` to visually locate the right date cell, then click by id.
- **Autocomplete dropdowns** — after typing into a city/airport field, re-read before picking a suggestion; the suggestions appear with their own IDs.
- **Login walls** — if you hit one, STOP and tell the user. Don't try to guess credentials.
- **Captchas** — STOP. Tell the user. This is a dead end for automation.

## Confirmation template (use verbatim for destructive final steps)

> About to book [FLIGHT/HOTEL/ITEM] — [details]. Total: £XX. Passenger/recipient: [name]. Ready to submit? (reply yes to confirm)

Do not proceed without an explicit yes.
