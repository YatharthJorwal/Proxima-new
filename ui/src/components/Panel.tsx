import type { ReactNode } from "react";

export function Panel({ title, actions, className = "", children, status }: {
  title: string; actions?: ReactNode; className?: string; children: ReactNode; status?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <h2>{title}</h2>
        <div className="panel-actions">{status}{actions}</div>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
