import type { SVGProps } from "react";

const PATHS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  camera: "M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 100-8 4 4 0 000 8z",
  memory: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6 M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  system: "M7 7h10v10H7z M10 10h4v4h-4z M9 3v4 M15 3v4 M9 17v4 M15 17v4 M3 9h4 M3 15h4 M17 9h4 M17 15h4",
  tools: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  studio: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5",
  settings: "M4 7h10 M18 7h2 M4 17h2 M10 17h10 M14 5v4 M6 15v4",
  mic: "M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z M6 11a6 6 0 0012 0 M12 17v4",
  send: "M4 12l16-8-6 16-3-7z",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12M18 6L6 18",
  refresh: "M20 11a8 8 0 10-2.3 5.7 M20 4v7h-7",
  bluetooth: "M7 7l10 10-5 4V3l5 4L7 17",
  audio: "M4 10v4h4l5 4V6l-5 4z M16 9a4 4 0 010 6",
  device: "M5 5h14v10H5z M9 19h6 M12 15v4",
  pin: "M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v5H5V6h5",
  trash: "M5 7h14 M9 7V4h6v3 M7 7l1 13h8l1-13",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <circle cx="16" cy="16" r="7" stroke="currentColor" strokeWidth="1.6" />
      <ellipse cx="16" cy="16" rx="14" ry="5.5" transform="rotate(-24 16 16)" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2.2" fill="currentColor" />
    </svg>
  );
}
