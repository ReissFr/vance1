// Minimal Twilio REST client. No SDK — just fetch + Basic Auth.
// Handles outbound SMS, outbound calls (TwiML speaks a message + hangs up), and
// inbound webhook signature verification per https://www.twilio.com/docs/usage/webhooks/webhooks-security.

import crypto from "node:crypto";

const API_ROOT = "https://api.twilio.com/2010-04-01";

export type TwilioEnv = {
  accountSid: string;
  authToken: string;
  fromNumber: string; // E.164 UK number you own on Twilio, e.g. +447700900000
  whatsappFrom: string; // "whatsapp:+14155238886" for sandbox, or your approved sender
  publicBaseUrl: string; // Public HTTPS base where Twilio can reach /api/twilio/*
};

export class TwilioNotConfiguredError extends Error {
  constructor(missing: string[]) {
    super(`Twilio not configured: missing ${missing.join(", ")}`);
    this.name = "TwilioNotConfiguredError";
  }
}

export function twilioEnv(): TwilioEnv {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  const fromNumber = process.env.TWILIO_PHONE_NUMBER ?? "";
  const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM ?? "";
  const publicBaseUrl =
    process.env.TWILIO_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const missing: string[] = [];
  if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!authToken) missing.push("TWILIO_AUTH_TOKEN");
  if (!fromNumber) missing.push("TWILIO_PHONE_NUMBER");
  if (!publicBaseUrl) missing.push("TWILIO_PUBLIC_BASE_URL");
  if (missing.length) throw new TwilioNotConfiguredError(missing);
  return { accountSid, authToken, fromNumber, whatsappFrom, publicBaseUrl };
}

export function isValidE164(n: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(n);
}

function basicAuthHeader(sid: string, token: string): string {
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

type TwilioMessageResponse = { sid: string; status: string; error_message?: string };
type TwilioCallResponse = { sid: string; status: string };

export async function sendSms(env: TwilioEnv, to: string, body: string): Promise<TwilioMessageResponse> {
  if (!isValidE164(to)) throw new Error(`invalid E.164 number: ${to}`);
  const statusCallback = `${env.publicBaseUrl.replace(/\/+$/, "")}/api/twilio/status`;
  const res = await fetch(`${API_ROOT}/Accounts/${env.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(env.accountSid, env.authToken),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: env.fromNumber,
      Body: body.slice(0, 1500),
      StatusCallback: statusCallback,
    }),
  });
  const data = (await res.json()) as TwilioMessageResponse & { message?: string };
  if (!res.ok) throw new Error(`twilio SMS ${res.status}: ${data.message ?? data.error_message ?? "error"}`);
  return data;
}

// WhatsApp uses the same Messages API — just prefix To/From with "whatsapp:".
// For the Twilio sandbox, whatsappFrom is "whatsapp:+14155238886" and the
// recipient must have joined the sandbox by texting the "join <code>" phrase.
export async function sendWhatsApp(env: TwilioEnv, to: string, body: string): Promise<TwilioMessageResponse> {
  if (!isValidE164(to)) throw new Error(`invalid E.164 number: ${to}`);
  if (!env.whatsappFrom) throw new Error("TWILIO_WHATSAPP_FROM not configured");
  const from = env.whatsappFrom.startsWith("whatsapp:") ? env.whatsappFrom : `whatsapp:${env.whatsappFrom}`;
  const statusCallback = `${env.publicBaseUrl.replace(/\/+$/, "")}/api/twilio/status`;
  const res = await fetch(`${API_ROOT}/Accounts/${env.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(env.accountSid, env.authToken),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: `whatsapp:${to}`,
      From: from,
      Body: body.slice(0, 1500),
      StatusCallback: statusCallback,
    }),
  });
  const data = (await res.json()) as TwilioMessageResponse & { message?: string };
  if (!res.ok) throw new Error(`twilio WhatsApp ${res.status}: ${data.message ?? data.error_message ?? "error"}`);
  return data;
}

export async function startCall(
  env: TwilioEnv,
  to: string,
  notificationId: string,
): Promise<TwilioCallResponse> {
  if (!isValidE164(to)) throw new Error(`invalid E.164 number: ${to}`);
  const base = env.publicBaseUrl.replace(/\/+$/, "");
  const twimlUrl = `${base}/api/twilio/twiml/${notificationId}`;
  const statusCallback = `${base}/api/twilio/status`;
  const res = await fetch(`${API_ROOT}/Accounts/${env.accountSid}/Calls.json`, {
    method: "POST",
    headers: {
      authorization: basicAuthHeader(env.accountSid, env.authToken),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: env.fromNumber,
      Url: twimlUrl,
      Method: "GET",
      StatusCallback: statusCallback,
      StatusCallbackEvent: "completed",
      StatusCallbackMethod: "POST",
    }),
  });
  const data = (await res.json()) as TwilioCallResponse & { message?: string };
  if (!res.ok) throw new Error(`twilio Call ${res.status}: ${data.message ?? "error"}`);
  return data;
}

// Verify a Twilio webhook signature.
// Spec: HMAC-SHA1 of (full URL + sorted POST params concatenated), base64-encoded,
// keyed with the auth token. Header: X-Twilio-Signature.
export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  headerSignature: string | null,
): boolean {
  if (!headerSignature) return false;
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const k of sortedKeys) data += k + params[k];
  const expected = crypto.createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(headerSignature));
  } catch {
    return false;
  }
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
