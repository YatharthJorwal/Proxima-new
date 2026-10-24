import { useCallback, useEffect, useState } from "react";
import { useEngine } from "./bridge/store";
import { INPUT_ID } from "./components/InputPanel";
import { PAGES, PageId, Sidebar } from "./components/Sidebar";
import { SettingsModal } from "./components/SettingsModal";
import { Topbar } from "./components/Topbar";
import { CameraPage } from "./pages/CameraPage";
import { HomePage } from "./pages/HomePage";
import { MemoryPage } from "./pages/MemoryPage";
import { StudioPage } from "./pages/StudioPage";
import { SystemPage } from "./pages/SystemPage";
import { ToolsPage } from "./pages/ToolsPage";

const NAV_KEY = "proxima.nav-open";

function initialNavOpen(): boolean {
  try { const v = localStorage.getItem(NAV_KEY); if (v !== null) return v === "1"; } catch { /* storage unavailable */ }
  return window.innerWidth >= 1280;
}

export function App() {
  const state = useEngine();
  const [page, setPage] = useState<PageId>("home");
  const [navOpen, setNavOpen] = useState(initialNavOpen);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleNav = () => setNavOpen((v) => { try { localStorage.setItem(NAV_KEY, v ? "0" : "1"); } catch { /* ignore */ } return !v; });
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
      if (e.key === "/" && !typing && !settingsOpen) {
        e.preventDefault();
        setPage("home");
        requestAnimationFrame(() => document.getElementById(INPUT_ID)?.focus());
      } else if (e.altKey && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        setPage(PAGES[Number(e.key) - 1].id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  return (
    <div className={`shell${navOpen ? " nav-open" : ""}`}>
      <Sidebar page={page} onPage={setPage} onSettings={() => setSettingsOpen(true)} state={state} />
      <div className="stage">
        <Topbar state={state} navOpen={navOpen} onToggleNav={toggleNav} onSettings={() => setSettingsOpen(true)} />
        <main className="page" id="page">
          {page === "home" && <HomePage state={state} onPage={setPage} />}
          {page === "camera" && <CameraPage />}
          {page === "memory" && <MemoryPage state={state} />}
          {page === "system" && <SystemPage state={state} />}
          {page === "tools" && <ToolsPage />}
          {page === "studio" && <StudioPage />}
        </main>
      </div>
      {settingsOpen && <SettingsModal onClose={closeSettings} />}
    </div>
  );
}
