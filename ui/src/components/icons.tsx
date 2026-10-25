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
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 12l8-4.5 M12 12v9 M12 12L4 7.5",
  sphere: "M12 3a9 9 0 100 18 9 9 0 000-18z M3 12c0 2.2 4 4 9 4s9-1.8 9-4 M12 3c-3.2 2.6-3.2 15.4 0 18 M12 3c3.2 2.6 3.2 15.4 0 18",
  cylinder: "M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6",
  cone: "M12 3L5 18c0 1.7 3.1 3 7 3s7-1.3 7-3L12 3z M5 18c0 1.2 3.1 2.2 7 2.2s7-1 7-2.2",
  torus: "M12 6c-5 0-9 2.7-9 6s4 6 9 6 9-2.7 9-6-4-6-9-6z M12 9.5c-2.5 0-4.5 1-4.5 2.5s2 2.5 4.5 2.5 4.5-1 4.5-2.5-2-2.5-4.5-2.5z",
  move: "M12 3v18 M3 12h18 M12 3l-3 3 M12 3l3 3 M12 21l-3-3 M12 21l3-3 M3 12l3-3 M3 12l3 3 M21 12l-3-3 M21 12l-3 3",
  rotate: "M20 11a8 8 0 10-2.3 5.7 M20 4v7h-7",
  scale: "M4 20L20 4 M14 4h6v6 M4 14v6h6",
  union: "M3 8h11v11H3z M10 5h11v11H10z",
  subtract: "M3 8h11v11H3z M10 5h11v11H10z M10 8v8h4",
  import: "M12 4v12 M7 11l5 5 5-5 M4 20h16",
  export: "M12 16V4 M7 9l5-5 5 5 M4 20h16",
  frame: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
  grid: "M4 4h16v16H4z M4 12h16 M12 4v16",
  undo: "M9 14L4 9l5-5 M4 9h10a6 6 0 010 12h-3",
  ruler: "M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 100-6 3 3 0 000 6z",
  zoom: "M11 4a7 7 0 100 14 7 7 0 000-14z M21 21l-5-5",
  orbit: "M12 12m-2 0a2 2 0 104 0 2 2 0 10-4 0 M4 12a8 4 0 1016 0 8 4 0 10-16 0",
  pan: "M9 11V5a1.5 1.5 0 013 0v5 M12 10V4a1.5 1.5 0 013 0v7 M15 10V6a1.5 1.5 0 013 0v8a7 7 0 01-7 7h-1a6 6 0 01-4.6-2.2L4 15.5a1.6 1.6 0 012.4-2L9 16",
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
