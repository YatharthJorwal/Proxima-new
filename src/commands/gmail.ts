/**
 * Gmail tool — Milestone 10 Part C, Gmail slice ("do I have any new
 * emails", "any emails from priya", "check for emails about the
 * invoice"). Read-only by design: the OAuth scope requested
 * (gmail.readonly) can't send, delete, or modify anything, so unlike
 * Milestone 10 Part B (run_script), this doesn't need a confirmation
 * gate to ship safely - the worst case of a wrong call here is an
 * irrelevant search, not a destructive action. Same reasoning shape as
 * fileTools.ts's sandboxing argument, applied to a different kind of
 * boundary (an OAuth scope instead of a filesystem path).
 *
 * A query tool, same family as systemUsage.ts (fetches real data to
 * reason over and relay), not an action tool like open_app/volume/
 * window/browse. See that file's docblock for why that distinction
 * matters mechanically - this one follows the same fetch-then-summarize
 * shape.
 *
 * Only fetches metadata (From/Subject/Date headers) plus Gmail's own
 * short `snippet` field, never the full message body - the model only
 * needs enough to relay "you have an email from X about Y," not the
 * entire email content, and pulling less keeps this fast and avoids
 * handing full email bodies to the LLM's context unnecessarily.
 *
 * Setup is a one-time OAuth authorization (scripts/gmail-auth.js, `npm
 * run setup:gmail`) - see README.md for the full Google Cloud Console
 * steps. GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET/GMAIL_REFRESH_TOKEN are
 * read directly from process.env here, same "tool module owns its own
 * config" pattern as fileTools.ts's PROXY_WORKSPACE_DIR - engine.ts has
 * no reason to know about Gmail credentials.
 */

import { google } from "googleapis";

export interface EmailSummary {
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

/**
 * Thrown when the required env vars aren't set. A distinct type (not a
 * plain Error) so executeGetEmails() can give a specific, actionable
 * reply ("run the setup") instead of the generic "something went wrong"
 * every other failure gets - the two situations need different replies,
 * since one is "you haven't finished setup" and the other is a genuine
 * runtime failure.
 */
export class GmailNotConfiguredError extends Error {
  constructor() {
    super("Gmail credentials are not configured.");
    this.name = "GmailNotConfiguredError";
  }
}

function getGmailClient() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new GmailNotConfiguredError();
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: "v1", auth: oauth2Client });
}

/**
 * Gmail's From header is usually `"Display Name <email@example.com>"` -
 * spoken aloud, "email from Priya Shah" reads far better than "email
 * from Priya Shah angle-bracket priya at example dot com." Falls back to
 * the bare address when there's no display name to extract.
 */
function simplifyFromHeader(from: string): string {
  const match = from.match(/^"?([^"<]+?)"?\s*<[^>]+>$/);
  return match ? match[1].trim() : from.trim();
}

function getHeader(headers: { name?: string | null; value?: string | null }[] | undefined, name: string): string {
  const header = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value ?? "";
}

/**
 * Fetches recent emails, optionally filtered by Gmail's own search
 * syntax (e.g. "is:unread", "from:priya@example.com", "subject:invoice"
 * - identical to what you'd type into Gmail's search box). Omitting
 * query returns the most recent inbox messages, unfiltered.
 *
 * One list call plus one metadata-only get per result - more round
 * trips than systemUsage.ts's single PowerShell call, but there's no
 * Gmail API equivalent that returns headers for multiple messages in
 * one request. maxResults is capped at 10 to keep this from turning
 * into a slow, context-heavy request for something meant to answer "do
 * I have new mail," not paginate an entire inbox.
 */
export async function fetchRecentEmails(query?: string, maxResults = 5): Promise<EmailSummary[]> {
  const gmail = getGmailClient();
  const cappedResults = Math.max(1, Math.min(maxResults, 10));

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: cappedResults,
  });

  const messages = listResponse.data.messages ?? [];
  if (messages.length === 0) return [];

  const details = await Promise.all(
    messages.map((m) =>
      gmail.users.messages.get({
        userId: "me",
        id: m.id!,
        format: "metadata",
        metadataHeaders: ["From", "Subject", "Date"],
      })
    )
  );

  return details.map((d) => {
    const headers = d.data.payload?.headers;
    return {
      from: simplifyFromHeader(getHeader(headers, "From")),
      subject: getHeader(headers, "Subject") || "(no subject)",
      date: getHeader(headers, "Date"),
      snippet: d.data.snippet ?? "",
    };
  });
}

/**
 * Does the actual work for the orchestrator tool - fetches emails and
 * turns them into a short, spoken-friendly summary, same shape as
 * executeGetSystemUsage(). No regex fast path (same reasoning as
 * fileTools.ts) - "check my email" and "any emails from priya" have too
 * many natural phrasings to pattern-match cheaply.
 */
export async function executeGetEmails(args: { query?: string; max_results?: number }): Promise<string> {
  try {
    const emails = await fetchRecentEmails(args.query, args.max_results ?? 5);

    if (emails.length === 0) {
      return args.query
        ? `I didn't find any emails matching "${args.query}".`
        : "I didn't find anything in the inbox.";
    }

    const lines = emails
      .map((e) => `from ${e.from}, subject "${e.subject}": ${e.snippet}`)
      .join(". ");
    return `Found ${emails.length} email${emails.length === 1 ? "" : "s"}: ${lines}`;
  } catch (err) {
    if (err instanceof GmailNotConfiguredError) {
      return "Gmail isn't connected yet - run \"npm run setup:gmail\" and follow the README's Gmail setup step first.";
    }
    console.error("Failed to fetch emails:", err);
    return "I tried to check your email but something went wrong.";
  }
}
