/** User-triggered RSS news fetch for Milestone 21. */
export interface NewsItem {
  title: string;
  summary: string;
  link: string;
  published: string;
  source: string;
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

async function readFeed(feed: (typeof FEEDS)[number], signal: AbortSignal): Promise<NewsItem[]> {
  const response = await fetch(feed.url, { signal, headers: { accept: "application/rss+xml, application/xml, text/xml" } });
  if (!response.ok) throw new Error(`${feed.name} returned HTTP ${response.status}`);
  const xml = (await response.text()).slice(0, 2_000_000);
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 30).map(([, block]) => {
    const title = field(block, "title");
    const link = field(block, "link");
    let safeLink = "";
    try { const parsed = new URL(link); if (parsed.protocol === "https:") safeLink = parsed.href; } catch { /* omit malformed links */ }
    return {
      title: title.slice(0, 240),
      summary: field(block, "description").slice(0, 800),
      link: safeLink,
      published: field(block, "pubDate"),
      source: feed.name,
    };
  }).filter((item) => item.title && item.link);
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
