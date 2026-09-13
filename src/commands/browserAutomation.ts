/**
 * Browser automation — the capability browse.ts's own docblock flagged
 * as a "stretch goal, only worth it if URL templating turns out
 * insufficient." It did: browse.ts can open a search results page, but
 * nothing could click a result, fill a field, or read what's actually on
 * screen. This is that stretch goal, scoped through a real conversation
 * (not defaulted on) the same way Part B's confirmation mechanism was:
 *
 * 1. Drives the user's ACTUAL Chrome profile (their choice, over an
 *    isolated one) — real logins, real usefulness, real stakes if it
 *    clicks the wrong thing.
 * 2. Confirmation only for "committing" actions (submit/buy/delete/
 *    send), not every click/type — otherwise this would turn every
 *    multi-step task into a back-and-forth.
 * 3. Visible, not headless, with an animated cursor — the user explicitly
 *    wants to watch it work and be able to intervene in real time.
 *
 * ARCHITECTURE — attaching, not launching:
 * Chrome only lets one process touch a given profile at a time, so this
 * can't launch its own second Chrome instance pointed at the user's real
 * profile — it has to ATTACH to one already running with remote
 * debugging enabled. config/commands.json's "chrome" entry now launches
 * Chrome with --remote-debugging-port=9222 (see launch.ts and openApp.ts)
 * whenever the user says "open chrome" — CDP_PORT below has to keep
 * matching that number, since a JSON config file can't read this file's
 * constant or an env var; if you ever change one, change both. If Chrome
 * is already open WITHOUT that flag (started some other way), this can't
 * attach to it — connectOverCDP() will fail, and the honest answer is to
 * say so and suggest relaunching via "open chrome" or the debug shortcut,
 * not to silently do nothing or crash.
 *
 * Note for anyone worried about the "controlled by automated test
 * software" banner Chrome sometimes shows: that's specific to
 * `--enable-automation` / launching your own throwaway browser, which
 * connectOverCDP() (attaching to an already-running, normally-launched
 * Chrome) doesn't add. Normal browsing is otherwise unaffected.
 *
 * ELEMENT MODEL — labeled IDs, not free-text or raw coordinates:
 * The model can't see the page, so every action here returns a compact,
 * numbered list of the current page's interactive elements (buttons,
 * links, inputs) — browser_click/browser_type reference an element by
 * that number, tagged directly onto the DOM node as `data-proxy-id` so
 * resolving an ID back to the real element is a single attribute
 * selector, not fuzzy text matching against a description. A fresh
 * snapshot replaces the old one on every navigate/click/type call, so a
 * stale ID from three actions ago simply won't resolve — same "don't
 * act on state you haven't actually checked" principle as the rest of
 * this codebase.
 *
 * `resultInformsNextStep: true` on all four tools (tools.ts) matters
 * here specifically: the labeled-element list is context for the
 * model's NEXT decision, not something that should ever be spoken
 * verbatim — same "don't dump raw tool output" lesson project-status.md
 * already logged for get_system_usage, applied here from the start.
 *
 * CONFIRMATION — reuses Part B's exact pattern, not a new one:
 * A click flagged as risky (see looksLikeCommit() below) never executes
 * immediately. It stores the target element and asks a yes/no question,
 * resolved on a SEPARATE following turn — see runScript.ts's docblock
 * for why a follow-up turn rather than a mid-run pause (this app has no
 * "stay listening" concept anywhere else). The one difference from
 * run_script: what's "pending" here is a reference to an element on a
 * page that's still open and unchanged (the browser session persists
 * between turns, unlike a script execution), so confirming just clicks
 * that element on the page as it already is — it does not re-run
 * whatever multi-step task led up to it. If more needs to happen after
 * the confirmed click, that's a new request, same as everywhere else
 * confirmation is used in this app.
 *
 * SCOPE LEFT FOR LATER, on purpose: browser_type has no "press Enter to
 * submit" option. A field that submits on Enter still needs a separate
 * browser_click on whatever triggers that submission, so every
 * "did this just commit something" decision goes through the one
 * already-reasoned-through heuristic below, instead of a second,
 * differently-shaped guess for text fields.
 */

import { chromium, Browser, Page } from "playwright-core";
import { spawn } from "child_process";
import { classifyYesNo } from "./confirmationUtils";

// Must match config/commands.json's chrome "args" entry — see this
// file's docblock.
const CDP_PORT = 9222;

const NOT_RUNNING_MESSAGE =
  "I can't reach Chrome for that - it isn't open. " + 'Say "open chrome" and try again.';

/**
 * Distinguishes two genuinely different failure causes instead of
 * collapsing them into one generic message - real-machine testing
 * showed the plain "not reachable" line was misleading in the common
 * case: Chrome was already running (just never launched with the debug
 * flag, since that flag only applies on a truly fresh launch - Chrome's
 * single-instance behavior means invoking it again while already open
 * just activates the existing window, silently ignoring new command-line
 * arguments). Best-effort - if the check itself fails for any reason,
 * falls back to the plain not-running message rather than blocking on a
 * diagnostic that isn't the actual point.
 */
function isChromeProcessRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const ps = spawn("powershell.exe", [
      "-WindowStyle",
      "Hidden",
      "-Command",
      "if (Get-Process chrome -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }",
    ]);
    let stdout = "";
    ps.stdout.on("data", (chunk) => (stdout += chunk));
    ps.on("close", () => resolve(stdout.trim() === "yes"));
    ps.on("error", () => resolve(false));
  });
}

async function buildNotReachableMessage(): Promise<string> {
  const alreadyRunning = await isChromeProcessRunning();
  if (!alreadyRunning) return NOT_RUNNING_MESSAGE;

  return (
    "Chrome's already running, but not with remote debugging on - that flag only takes effect on a genuinely " +
    "fresh launch, so if it was already open, opening it again just activated the existing window instead of " +
    "turning debugging on. Close every Chrome window completely (check the taskbar/system tray too - it can " +
    'keep running in the background after the last window closes) and say "open chrome" again.'
  );
}

// Conservative on purpose - would rather ask for confirmation on
// something harmless than miss something that genuinely commits to an
// action. "accept" alone is deliberately excluded (catches "accept
// cookies," which isn't risky); the phrases below are all specific
// enough that a false positive just costs one unnecessary confirmation,
// while a false negative would mean an unconfirmed purchase/deletion/send.
const COMMIT_KEYWORDS = [
  "buy",
  "purchase",
  "checkout",
  "place order",
  "pay",
  "confirm order",
  "confirm purchase",
  "submit",
  "delete",
  "remove",
  "unsubscribe",
  "cancel subscription",
  "deactivate",
  "send",
  "subscribe",
  "sign up",
  "agree",
  "accept terms",
];

interface ElementInfo {
  id: string;
  tag: string;
  type: string;
  name: string;
}

// Module-level, matching runScript.ts's "there's only one Proxy" style -
// no need for anything fancier than single variables here either.
let browser: Browser | null = null;
let page: Page | null = null;
let lastSnapshot: ElementInfo[] = [];

interface PendingBrowserClick {
  elementId: string;
  description: string;
}

let pendingClick: PendingBrowserClick | null = null;

/**
 * Attaches to (or reuses an existing attachment to) the user's real
 * Chrome, and returns the one tab Proxy drives. Proxy always drives
 * exactly one tab of its own — v1 deliberately doesn't try to guess
 * which of the user's other open tabs "the currently active one" might
 * be; if that turns out to matter, it's a scoped addition, not a rework.
 */
async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;

  if (!browser || !browser.isConnected()) {
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
  }

  const context = browser.contexts()[0] ?? (await browser.newContext());
  page = await context.newPage();
  return page;
}

/**
 * Runs entirely inside the page via a single evaluate() call (one round
 * trip, not one per element) - tags each interactive, visible, named
 * element with a data-proxy-id attribute and returns a plain list of
 * {id, tag, type, name}. Unlabeled elements are skipped: with nothing to
 * call it by, it couldn't be referenced by ID in conversation anyway.
 * Capped at 40 - a page with more interactive elements than that needs
 * scrolling/narrowing, not a longer dump into the model's context.
 */
async function takeSnapshot(target: Page): Promise<ElementInfo[]> {
  const results = (await target.evaluate(() => {
    const SELECTOR =
      'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="menuitem"]';
    const elements = Array.from(document.querySelectorAll(SELECTOR));
    const out: { id: string; tag: string; type: string; name: string }[] = [];
    let counter = 0;

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const name = (
        el.getAttribute("aria-label") ||
        (el as HTMLElement).innerText ||
        el.getAttribute("placeholder") ||
        el.getAttribute("value") ||
        el.getAttribute("alt") ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80);
      if (!name) continue;

      counter += 1;
      const id = String(counter);
      el.setAttribute("data-proxy-id", id);
      out.push({ id, tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || "", name });
      if (counter >= 40) break;
    }
    return out;
  })) as ElementInfo[];

  lastSnapshot = results;
  return results;
}

function formatSnapshot(elements: ElementInfo[]): string {
  if (elements.length === 0) return "No labeled interactive elements found on this page.";
  const lines = elements.map((e) => `[${e.id}] ${e.tag}${e.type ? `(${e.type})` : ""} "${e.name}"`);
  return `Page elements:\n${lines.join("\n")}`;
}

function looksLikeCommit(el: ElementInfo): boolean {
  const lower = el.name.toLowerCase();
  if (COMMIT_KEYWORDS.some((k) => lower.includes(k))) return true;
  if (el.type === "submit") return true;
  return false;
}

/**
 * Smooth movement + a brief highlight ring, not Playwright's default
 * instant teleport-and-click — the user explicitly wants to watch this
 * happen. Both are pure client-side visuals: `steps` walks the pointer
 * through that many intermediate points, and the ring is a plain
 * absolutely-positioned div that removes itself - neither touches the
 * page's own state or scripts, and neither costs anything to run beyond
 * the CPU cycles already spent on every other DOM operation here.
 */
async function animatedClick(target: Page, elementId: string): Promise<void> {
  const locator = target.locator(`[data-proxy-id="${elementId}"]`);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();

  if (!box) {
    // Couldn't get on-screen coordinates (rare - usually a layout shift
    // between snapshot and click) - fall back to Playwright's own
    // click(), which has its own retry/actionability checks, rather than
    // failing outright over a missing animation.
    await locator.click();
    return;
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await target.mouse.move(x, y, { steps: 25 });
  await target.evaluate(
    ({ px, py }) => {
      const ring = document.createElement("div");
      ring.style.cssText = `position:fixed;left:${px - 12}px;top:${py - 12}px;width:24px;height:24px;border:3px solid #ff5a36;border-radius:50%;z-index:2147483647;pointer-events:none;transition:transform 0.15s ease-out,opacity 0.3s ease-out;`;
      document.body.appendChild(ring);
      requestAnimationFrame(() => {
        ring.style.transform = "scale(1.6)";
        ring.style.opacity = "0";
      });
      setTimeout(() => ring.remove(), 350);
    },
    { px: x, py: y }
  );
  await target.mouse.down();
  await target.mouse.up();
}

function connectionLooksDead(): boolean {
  return !browser || !browser.isConnected() || !page || page.isClosed();
}

export async function executeBrowserNavigate(args: { url?: string }): Promise<string> {
  const url = args.url ?? "";
  if (!url) return "I need a URL or address to navigate to.";

  try {
    const target = await getPage();
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    await target.goto(normalized, { waitUntil: "domcontentloaded" });
    const snapshot = await takeSnapshot(target);
    return `Opened ${normalized}.\n${formatSnapshot(snapshot)}`;
  } catch (err) {
    console.error("browser_navigate failed:", err);
    return buildNotReachableMessage();
  }
}

export async function executeBrowserReadPage(): Promise<string> {
  try {
    const target = await getPage();
    const snapshot = await takeSnapshot(target);
    return formatSnapshot(snapshot);
  } catch (err) {
    console.error("browser_read_page failed:", err);
    return buildNotReachableMessage();
  }
}

export async function executeBrowserClick(args: { element_id?: string; may_commit?: boolean }): Promise<string> {
  const elementId = args.element_id ?? "";
  const element = lastSnapshot.find((e) => e.id === elementId);

  if (!element) {
    return `I don't have an element [${elementId}] from the last page I looked at - try browser_read_page first to get current element numbers.`;
  }

  const isRisky = looksLikeCommit(element) || args.may_commit === true;
  if (isRisky) {
    pendingClick = { elementId, description: element.name };
    return `Ready to click "${element.name}" - say "yes" to confirm, or "no" to cancel.`;
  }

  try {
    const target = await getPage();
    await animatedClick(target, elementId);
    const snapshot = await takeSnapshot(target);
    return `Clicked "${element.name}".\n${formatSnapshot(snapshot)}`;
  } catch (err) {
    console.error("browser_click failed:", err);
    const detail = connectionLooksDead() ? ` ${await buildNotReachableMessage()}` : "";
    return `I tried to click "${element.name}" but something went wrong.${detail}`;
  }
}

export async function executeBrowserType(args: { element_id?: string; text?: string }): Promise<string> {
  const elementId = args.element_id ?? "";
  const text = args.text ?? "";
  const element = lastSnapshot.find((e) => e.id === elementId);

  if (!element) {
    return `I don't have an element [${elementId}] from the last page I looked at - try browser_read_page first to get current element numbers.`;
  }

  try {
    const target = await getPage();
    const locator = target.locator(`[data-proxy-id="${elementId}"]`);
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    // A visible per-character delay, not an instant paste - same
    // "watch it work" reasoning as animatedClick() above.
    await locator.pressSequentially(text, { delay: 25 });
    const snapshot = await takeSnapshot(target);
    return `Typed into "${element.name}".\n${formatSnapshot(snapshot)}`;
  } catch (err) {
    console.error("browser_type failed:", err);
    const detail = connectionLooksDead() ? ` ${await buildNotReachableMessage()}` : "";
    return `I tried to type into "${element.name}" but something went wrong.${detail}`;
  }
}

/**
 * Checked in engine.ts right after run_script's own
 * tryResolvePendingConfirmation() - see that file's docblock for the
 * shared "single following-turn, no timeout" design both of these use.
 */
export async function tryResolvePendingBrowserConfirmation(
  utterance: string
): Promise<{ handled: boolean; reply?: string; confirmed?: boolean }> {
  if (!pendingClick) return { handled: false };

  const decision = classifyYesNo(utterance);
  if (decision === "unclear") {
    pendingClick = null;
    return { handled: false };
  }

  const { elementId, description } = pendingClick;
  pendingClick = null;

  if (decision === "deny") {
    return { handled: true, reply: `Cancelled - I won't click "${description}".`, confirmed: false };
  }

  try {
    const target = await getPage();
    await animatedClick(target, elementId);
    const snapshot = await takeSnapshot(target);
    return { handled: true, confirmed: true, reply: `Clicked "${description}".\n${formatSnapshot(snapshot)}` };
  } catch (err) {
    console.error("Confirmed browser click failed:", err);
    return { handled: true, confirmed: true, reply: `I tried to click "${description}" but something went wrong.` };
  }
}

/** Exposed for engine.ts's activity-panel event, mirroring runScript.ts's getPendingConfirmation(). */
export function getPendingBrowserConfirmation(): { description: string } | null {
  return pendingClick ? { description: pendingClick.description } : null;
}

/** Exposed for tests - clears any pending confirmation and cached browser/page state between test cases. */
export function resetBrowserAutomationState(): void {
  pendingClick = null;
  lastSnapshot = [];
  browser = null;
  page = null;
}
