/** Minimal typing for Electron's <webview> tag, used only by the news reader. */
import "react";

export interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  goBack(): void;
  reload(): void;
  stop(): void;
  getURL(): string;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string; partition?: string };
    }
  }
}
