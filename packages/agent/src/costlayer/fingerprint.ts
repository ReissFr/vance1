import { createHash } from "node:crypto";

// Tokens that add no signal to the intent. Stripped during normalisation so
// "go on polymarket and buy trump" and "polymarket buy trump" hash alike.
const STOPWORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "by", "can", "could",
  "do", "does", "for", "from", "go", "got", "hey", "hi", "i", "if", "in",
  "into", "is", "it", "its", "just", "like", "may", "me", "might", "my",
  "no", "not", "of", "off", "on", "onto", "or", "over", "please", "pls",
  "so", "some", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "those", "to", "too", "up", "upon", "us", "want", "was",
  "way", "we", "were", "will", "with", "would", "yes", "you", "your",
]);

export interface NormalisedIntent {
  // Space-separated, lowercased, stopword-stripped tokens, ready to embed.
  text: string;
  // Deterministic sha256 over text + site, truncated for compactness.
  fingerprint: string;
  // Site/domain if the intent mentions a known service. null otherwise.
  site: string | null;
  // Extracted variable-looking values (quoted strings, amounts, emails, urls)
  // with their surface forms so the recorder can substitute placeholders.
  values: { name: string; value: string }[];
}

// Very small heuristic site detector. Extend freely as coverage grows.
const SITE_ALIASES: [RegExp, string][] = [
  [/\b(insta(?:gram)?)\b/i, "instagram.com"],
  [/\bpolymarket\b/i, "polymarket.com"],
  [/\bwhatsapp\b/i, "whatsapp.com"],
  [/\b(gmail|google\s+mail)\b/i, "gmail.com"],
  [/\btwitter\b|\bx\.com\b/i, "x.com"],
  [/\bfacebook\b/i, "facebook.com"],
  [/\blinked\s*in\b/i, "linkedin.com"],
  [/\btiktok\b/i, "tiktok.com"],
  [/\breddit\b/i, "reddit.com"],
  [/\byoutube\b/i, "youtube.com"],
  [/\bamazon\b/i, "amazon.com"],
  [/\bebay\b/i, "ebay.com"],
  [/\buber\b/i, "uber.com"],
  [/\bdeliveroo\b/i, "deliveroo.co.uk"],
  [/\bstripe\b/i, "stripe.com"],
  [/\bmonzo\b/i, "monzo.com"],
  [/\bbooking\.com\b|\bbooking\b/i, "booking.com"],
  [/\bairbnb\b/i, "airbnb.com"],
];

function detectSite(raw: string): string | null {
  for (const [re, site] of SITE_ALIASES) {
    if (re.test(raw)) return site;
  }
  const urlMatch = raw.match(/https?:\/\/([^\s/]+)/i);
  if (urlMatch && urlMatch[1]) return urlMatch[1].toLowerCase();
  return null;
}

// Pull out values that look like user-specific inputs the recorder should
// lift into variables at save time (quoted text, prices, emails, usernames,
// urls, numbers followed by common units).
function extractValues(raw: string): { name: string; value: string }[] {
  const values: { name: string; value: string }[] = [];

  for (const m of raw.matchAll(/"([^"]+)"|'([^']+)'/g)) {
    const v = (m[1] ?? m[2] ?? "").trim();
    if (v) values.push({ name: "text", value: v });
  }

  for (const m of raw.matchAll(/[£$€]\s*\d+(?:[.,]\d+)?/g)) {
    values.push({ name: "amount", value: m[0].replace(/\s+/g, "") });
  }

  for (const m of raw.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
    values.push({ name: "email", value: m[0] });
  }

  for (const m of raw.matchAll(/https?:\/\/\S+/g)) {
    values.push({ name: "url", value: m[0] });
  }

  return values;
}

// Normalise a user message into a stable intent representation. The output
// feeds two lookups: (1) fingerprint — exact-match DB index, (2) text —
// embedded for semantic match.
export function normaliseIntent(userMessage: string): NormalisedIntent {
  const site = detectSite(userMessage);
  const values = extractValues(userMessage);

  let cleaned = userMessage.toLowerCase();
  // Drop the exact extracted values so they don't contribute to the hash.
  for (const v of values) {
    cleaned = cleaned.split(v.value.toLowerCase()).join(" ");
  }

  cleaned = cleaned
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

  // Keep tokens sorted so "buy polymarket trump" and "polymarket trump buy"
  // fingerprint identically. Embedding still sees the unsorted original.
  const canonical = [...tokens].sort().join(" ");
  const hashInput = site ? `${site}|${canonical}` : canonical;
  const fingerprint = createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

  return { text: tokens.join(" "), fingerprint, site, values };
}
