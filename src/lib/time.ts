/** Timestamp formatting and links that point at the exact moment in the source. */

/** Formats seconds as mm:ss or h:mm:ss. */
export function stamp(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Moment as a file name fragment: 04m12s. */
export function formatFileTime(seconds: number): string {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}m${String(s % 60).padStart(2, "0")}s`;
}

/** Deep link to the moment in the source player, when the source supports it. */
export function deepLink(url: string | undefined, seconds: number): string | null {
  if (!url || !/youtube\.com|youtu\.be/.test(url)) return null;
  return `${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(seconds)}s`;
}

/** The moment as markdown: clickable when the source supports it, plain otherwise. */
export function stampLink(url: string | undefined, seconds: number): string {
  const label = stamp(seconds);
  const link = deepLink(url, seconds);
  return link ? `[${label}](${link})` : label;
}
