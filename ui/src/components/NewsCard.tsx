import { useState } from "react";
import type { NewsItem } from "../bridge/types";
import { Icon } from "./icons";
import { Panel } from "./Panel";

/** Only https images (what the backend returns) or inline data images may be shown. */
export const safeImage = (url: string): string => (/^https:\/\//i.test(url) || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(url) ? url : "");

export function NewsCard({ activeUrl, onOpen }: { activeUrl: string | null; onOpen: (item: NewsItem) => void }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [status, setStatus] = useState("Refresh to load current headlines.");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setStatus("Loading current feeds…");
    try {
      const result = await window.proxy?.fetchNews();
      if (!Array.isArray(result)) { setItems([]); setStatus(result?.error || "News is unavailable."); return; }
      setItems(result);
      setStatus(result.length ? `${result.length} current headlines. Click one to read it in the reader.` : "No headlines matched. Clear or adjust News interests in Settings.");
    } catch { setItems([]); setStatus("News feeds are unavailable right now."); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="News" className="news-card" actions={<button type="button" className="btn btn-small" onClick={refresh} disabled={busy}><Icon name="refresh" size={14} />Refresh</button>}>
      <p className="note" role="status">{status}</p>
      <ul className="news-list">
        {items.map((n, i) => {
          const img = safeImage(n.image);
          return (
            <li key={`${n.link}-${i}`}>
              <button type="button" className={`news-item${n.link === activeUrl ? " active" : ""}`} onClick={() => onOpen(n)}>
                {img ? <img className="news-thumb" src={img} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="news-thumb news-thumb-empty" aria-hidden="true" />}
                <span className="news-text"><span className="news-title">{n.title}</span><span className="news-source">{n.source}</span></span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
