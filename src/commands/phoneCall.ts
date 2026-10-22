import { classifyYesNo } from "./confirmationUtils";

interface PendingCall { to: string; message: string }
let pending: PendingCall | null = null;

/** First-phase outbound call: asks on one turn, places it only after a clear yes. */
export async function requestPhoneCall(args: { to?: string; message?: string }): Promise<string> {
  const to = (args.to || "").trim();
  const message = (args.message || "").trim();
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return "Use a phone number in international E.164 format, such as +14155550123.";
  if (!message || message.length > 500) return "The spoken message must be between 1 and 500 characters.";
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
    return "Twilio is not configured yet. Add the account SID, auth token, and Twilio number in Settings before requesting a call.";
  }
  pending = { to, message };
  return `I’m ready to call ${to} and say: “${message}”. Say yes to place the call, or no to cancel.`;
}

export async function resolvePendingPhoneCall(utterance: string): Promise<{ handled: boolean; reply?: string; confirmed?: boolean }> {
  if (!pending) return { handled: false };
  const decision = classifyYesNo(utterance);
  if (decision === "unclear") { pending = null; return { handled: false }; }
  const call = pending;
  pending = null;
  if (decision === "deny") return { handled: true, confirmed: false, reply: `Cancelled the call to ${call.to}.` };

  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  const from = process.env.TWILIO_FROM_NUMBER || "";
  if (!/^AC[0-9a-f]{32}$/i.test(sid) || !token || !/^\+[1-9]\d{7,14}$/.test(from)) {
    return { handled: true, confirmed: true, reply: "Call approved, but Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in your local settings, then try again." };
  }

  const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
  const body = new URLSearchParams({
    To: call.to,
    From: from,
    Twiml: `<Response><Say>${xmlEscape(call.message)}</Say></Response>`,
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Calls.json`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    return { handled: true, confirmed: true, reply: `Twilio could not place the call (HTTP ${response.status}). ${detail}` };
  }
  const result = await response.json() as { sid?: string };
  return { handled: true, confirmed: true, reply: `Twilio accepted the call to ${call.to}${result.sid ? ` (call ID ${result.sid})` : ""}.` };
}

export function getPendingPhoneCall(): { description: string } | null {
  return pending ? { description: `Call ${pending.to}: ${pending.message}` } : null;
}
