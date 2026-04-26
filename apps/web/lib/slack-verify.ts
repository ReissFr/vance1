import { createHmac, timingSafeEqual } from "node:crypto";

// Verifies Slack's HMAC signature on an incoming webhook (slash commands,
// events API, interactive payloads). Returns true iff signature matches and
// the timestamp is within ±5 minutes (Slack's replay window).
export function verifySlackSignature(
  signingSecret: string,
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + createHmac("sha256", signingSecret).update(base).digest("hex");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
