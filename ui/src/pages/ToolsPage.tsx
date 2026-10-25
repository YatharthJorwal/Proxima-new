import { useState } from "react";
import type { NewsItem } from "../bridge/types";
import { MapCard } from "../components/MapCard";
import { NewsCard } from "../components/NewsCard";
import { ReaderCard } from "../components/ReaderCard";

export function ToolsPage() {
  const [open, setOpen] = useState<{ url: string; title: string } | null>(null);
  return (
    <div className="tools-layout">
      <div className="stack">
        <MapCard />
        <ReaderCard url={open?.url ?? null} title={open?.title ?? ""} onClose={() => setOpen(null)} />
      </div>
      <NewsCard activeUrl={open?.url ?? null} onOpen={(n: NewsItem) => setOpen({ url: n.link, title: n.title })} />
    </div>
  );
}
