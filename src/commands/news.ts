/** User-triggered RSS news fetch for Milestone 21. */
export interface NewsItem {
  title: string;
  summary: string;
  link: string;
  published: string;
  source: string;
  /** https image URL from the feed (thumbnail or enclosure), or "" when the item has none. */
  image: string;
}

const FEEDS = [
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "BBC Asia", url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml" },
];

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ").trim();
}

function field(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

/** First https image URL the item offers: media:thumbnail, media:content, or an image enclosure. */
export function itemImage(block: string): string {
  const tags = block.match(/<(?:media:thumbnail|media:content|enclosure)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (/^<(?:media:content|enclosure)/i.test(tag) && /\btype\s*=\s*["'](?!image\/)/i.test(tag)) continue; // audio/video
    if (/^<media:content/i.test(tag) && /\bmedium\s*=\s*["'](?!image)/i.test(tag)) continue;
    const url = tag.match(/\burl\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!url || url.length > 600) continue;
    try {
      const parsed = new URL(url.replace(/&amp;/g, "&"));
      if (parsed.protocol === "https:") return parsed.href;
    } catch { /* skip malformed */ }
  }
  return "";
}

/** Pure RSS parsing (exported for tests): up to 30 items with a title and an https link. */
export function parseFeed(xml: string, sourceName: string): NewsItem[] {
  return [...xml.slice(0, 2_000_000).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 30).map(([, block]) => {
    const title = field(block, "title");
    const link = field(block, "link");
    let safeLink = "";
    try { const parsed = new URL(link); if (parsed.protocol === "https:") safeLink = parsed.href; } catch { /* omit malformed links */ }
    return {
      title: title.slice(0, 240),
      summary: field(block, "description").slice(0, 800),
      link: safeLink,
      published: field(block, "pubDate"),
      source: sourceName,
      image: itemImage(block),
    };
  }).filter((item) => item.title && item.link);
}

async function readFeed(feed: (typeof FEEDS)[number], signal: AbortSignal): Promise<NewsItem[]> {
  const response = await fetch(feed.url, { signal, headers: { accept: "application/rss+xml, application/xml, text/xml" } });
  if (!response.ok) throw new Error(`${feed.name} returned HTTP ${response.status}`);
  return parseFeed(await response.text(), feed.name);
}

export async function fetchNews(): Promise<NewsItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const results = await Promise.allSettled(FEEDS.map((feed) => readFeed(feed, controller.signal)));
    const items = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const interests = (process.env.PROXY_NEWS_INTERESTS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
    const filtered = interests.length
      ? items.filter((item) => interests.some((term) => `${item.title} ${item.summary}`.toLowerCase().includes(term)))
      : items;
    return filtered.sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, 12);
  } finally {
    clearTimeout(timeout);
  }
}
