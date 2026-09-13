/**
 * "Browse" command — Milestone 9's practical fast path for "open X and
 * search for Y" requests. No browser automation: just construct the
 * right URL (YouTube's /results?search_query=, Google's /search?q=,
 * etc.) and open it, the same Start-Process launcher openApp.ts uses.
 * Real browser automation (Playwright etc., for actually clicking/
 * filling/reading a page) stays a stretch goal, only worth it if URL
 * templating turns out insufficient for what's actually asked of Proxy.
 *
 * The site -> URL-template mapping lives in config/commands.json (a new
 * "browse" section, sibling to "openApp") — same config-driven pattern,
 * add a site without touching code.
 */

import * as fs from "fs";
import * as path from "path";
import { CommandHandler } from "./types";
import { launch } from "./launch";
import { LEAD_IN_SOURCE } from "./regexUtils";

interface BrowseConfig {
  browse: Record<string, string>;
}

// Same assumption as openApp.ts's CONFIG_PATH — see that file's comment.
const CONFIG_PATH = path.join(__dirname, "..", "config", "commands.json");

function loadConfig(): BrowseConfig {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as BrowseConfig;
}

const config = loadConfig();

/** Known site keys, straight from config — so the tool schema's enum can't drift out of sync with commands.json. */
export function getBrowseSites(): string[] {
  return Object.keys(config.browse);
}

// Matches "search youtube for lo-fi beats", "search google for the
// weather tomorrow", etc. Deliberately one narrow, canonical phrasing
// for the zero-latency fast path — same "fairly exact phrasing" trade-
// off the other regex handlers make (see commands/index.ts). Fuzzier
// phrasing ("open youtube and search for X", "look up X on google")
// still works, just through the LLM tool instead of this fast path.
const SEARCH_PATTERN = new RegExp(`^${LEAD_IN_SOURCE}search\\s+(.+?)\\s+for\\s+(.+?)[.!?]?$`, "i");

function normalizeSite(site: string): string {
  return site.trim().toLowerCase();
}

// When no query is given, don't try to string-strip the query string out
// of the template (fragile, and can land on an awkward empty search
// page like "/results" with nothing in it) — just derive the site's
// bare origin instead, so "open youtube" with no query lands on the
// actual homepage.
function bareSiteUrl(template: string): string {
  try {
    const url = new URL(template.replace("{query}", ""));
    return `${url.protocol}//${url.host}`;
  } catch {
    return template;
  }
}

/**
 * Does the actual work of building the URL and opening it, given a
 * (possibly LLM-extracted) site key and optional search query. Shared by
 * the regex handler below and the LLM tool in commands/tools.ts.
 */
export async function executeBrowse(siteRaw: string, query?: string): Promise<string> {
  const site = normalizeSite(siteRaw);
  const template = config.browse[site];

  if (!template) {
    // Same honesty principle as executeOpenApp: we know what's being
    // asked, just don't have that site configured — say so plainly
    // instead of talking about it without doing anything.
    return `I don't have "${site}" set up to browse yet. You can add it to commands.json.`;
  }

  const hasQuerySlot = template.includes("{query}");
  const url =
    hasQuerySlot && query
      ? template.replace("{query}", encodeURIComponent(query))
      : bareSiteUrl(template);

  try {
    await launch(url);
    return query ? `Searching ${site} for "${query}".` : `Opening ${site}.`;
  } catch (err) {
    console.error("Failed to open URL:", err);
    return `I tried to open ${site} but something went wrong.`;
  }
}

export const tryHandleBrowse: CommandHandler = async (text) => {
  const match = text.match(SEARCH_PATTERN);
  if (!match) return null;

  const site = normalizeSite(match[1]);
  if (!(site in config.browse)) {
    // Same reasoning as openApp.ts's tryHandleOpenApp: this regex only
    // fires on the narrow "search X for Y" phrasing, so a miss here
    // means a genuinely unconfigured (or misheard/typo'd) site name -
    // let the orchestrator take a shot at a better answer instead of
    // answering confidently wrong.
    return null;
  }

  return executeBrowse(match[1], match[2]);
};
