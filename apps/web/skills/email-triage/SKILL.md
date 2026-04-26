---
name: email-triage
description: Reading, summarising, and responding to email. Use when the user asks "what's in my inbox", "any important emails", "reply to X", "draft a response to Y", or asks you to find a specific email.
---

# Email Triage Playbook

## Listing emails

1. Call `list_emails` with a query that matches what the user asked for:
   - "unread" → `is:unread`
   - "today" → `newer_than:1d`
   - "from Sarah" → `from:sarah`
   - Default for "what's in my inbox" → `is:unread newer_than:3d` (don't dump everything).
2. The result gives you subject, sender, snippet, thread id.
3. **Summarise, don't dump.** Group by sender or topic when there are >5. Flag anything that looks urgent (meeting invites, invoices, deadlines).

## Reading a specific email

Only call `read_email` when you actually need the body — e.g. the snippet isn't enough, or the user asked for details. It costs more tokens than list_emails.

## Drafting a reply

1. Confirm you've read the original before drafting. Quote the key ask back to the user.
2. Call `draft_email` — this creates a Gmail draft, **it does NOT send**.
3. Tell the user: "Drafted. Review in Gmail and hit send, or tell me to tweak it."
4. Never auto-send. Email is high-stakes.

## What makes a good PA summary

- Lead with what needs a response today.
- Group routine stuff (newsletters, receipts) into one line.
- Surface deadlines and dollar amounts explicitly.
- Mention people by first name if the user knows them (check memories).

## Tone for drafts

Match the user's tone — if their past emails are short and direct, draft short and direct. Don't pad with "I hope this email finds you well." Default: warm, direct, 2-3 sentences.
