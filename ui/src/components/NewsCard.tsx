import { useState } from "react";
import type { NewsItem } from "../bridge/types";
import { Icon } from "./icons";
import { Panel } from "./Panel";

export function NewsCard() {
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
      setStatus(result.length ? `${result.length} current headlines` : "No headlines matched. Clear or adjust News interests in Settings.");
    } catch { setItems([]); setStatus("News feeds are unavailable right now."); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="News" className="news-card" actions={<button type="button" className="btn btn-small" onClick={refresh} disabled={busy}><Icon name="refresh" size={14} />Refresh</button>}>
      <p className="note" role="status">{status}</p>
      <ul className="news-list">
        {items.map((n, i) => (
          <li key={`${n.link}-${i}`}>
            <a href={n.link} target="_blank" rel="noreferrer"><span className="news-title">{n.title}</span><span className="news-source">{n.source}</span></a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
