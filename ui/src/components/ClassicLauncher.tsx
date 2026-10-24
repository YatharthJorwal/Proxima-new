import type { ClassicView } from "../bridge/types";
import { Panel } from "./Panel";

export function ClassicLauncher({ view, title, children }: { view: ClassicView; title: string; children: React.ReactNode }) {
  return (
    <Panel title={title} className="classic-card">
      <div className="classic-body">
        <p>{children}</p>
        <p className="note">This page moves into the new shell once it has been confirmed on this machine. Until then it opens in its own window and works exactly as before.</p>
        <div><button type="button" className="btn btn-primary" onClick={() => window.proxy?.openClassic(view)}>Open in classic window</button></div>
      </div>
    </Panel>
  );
}
