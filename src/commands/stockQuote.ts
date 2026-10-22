const API_URL = "https://www.alphavantage.co/query";
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; result: string }>();

/** Fetches Alpha Vantage's default latest end-of-day quote for one symbol. */
export async function getStockQuote(rawSymbol: string): Promise<string> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,12}(\.[A-Z0-9]{1,8})?$/.test(symbol)) {
    return "Enter one valid ticker symbol, such as IBM or TSCO.LON.";
  }
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (!apiKey) return "Stock quotes are not connected yet. Add a free Alpha Vantage API key in Settings, then restart Proxy.";

  const cached = cache.get(symbol);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const url = new URL(API_URL);
  url.searchParams.set("function", "GLOBAL_QUOTE");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) return `Alpha Vantage returned HTTP ${response.status}; no quote was available.`;
    const payload = await response.json() as Record<string, unknown>;
    const notice = payload.Note || payload.Information || payload["Error Message"];
    if (typeof notice === "string") {
      return notice.toLowerCase().includes("api call frequency") || notice.toLowerCase().includes("25 requests")
        ? "Alpha Vantage's free daily request limit may have been reached. Try again tomorrow or review the provider's current plan."
        : `Alpha Vantage could not return that quote: ${notice.slice(0, 300)}`;
    }
    const quote = payload["Global Quote"] as Record<string, string> | undefined;
    if (!quote || !quote["05. price"]) return `No quote was returned for ${symbol}. Check the ticker and exchange suffix.`;

    const price = Number(quote["05. price"]);
    const change = Number(quote["09. change"]);
    const tradingDay = quote["07. latest trading day"] || "an unknown trading day";
    if (!Number.isFinite(price) || !Number.isFinite(change)) return `Alpha Vantage returned an invalid quote for ${symbol}.`;
    const result = `${symbol}: ${price.toFixed(2)} (currency is not included in this quote response); change ${change >= 0 ? "+" : ""}${change.toFixed(2)} (${quote["10. change percent"] || "percent not supplied"}) from previous close. Latest trading day: ${tradingDay}. Alpha Vantage's default quote is end-of-day, not real-time.`;
    cache.set(symbol, { expiresAt: Date.now() + CACHE_TTL_MS, result });
    if (cache.size > 100) cache.delete(cache.keys().next().value!);
    return result;
  } catch (error) {
    console.error("Stock quote request failed:", error);
    return "The stock quote service is unavailable right now. No quote was retrieved.";
  }
}
