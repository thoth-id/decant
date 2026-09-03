import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { AttributionSource } from "./credits.ts";
import type { Chapter } from "./resources.ts";
import { CMD } from "./cli.ts";
import { firstLine, run } from "./shell.ts";

/** Everything the platform told us, plus the local file it resolved to. */
export interface SourceMeta extends AttributionSource {
  /** Local path to the video file, ready to process. */
  videoPath: string;
  /** Duration in seconds. */
  duration: number;
}

/** What the platform knows about the work, before any download. */
export type SourceInfo = Omit<SourceMeta, "videoPath" | "duration"> & { duration?: number };

/** Normalizes a title into a directory slug. */
export function slugify(input: string): string {
  return input
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "video";
}

/** Reads duration and title from a local file via ffprobe. */
async function probe(path: string): Promise<{ duration: number; title: string }> {
  const raw = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration:format_tags=title",
    "-of", "json", path,
  ]);
  const fmt = JSON.parse(raw).format ?? {};
  return {
    duration: Number(fmt.duration ?? 0),
    title: fmt.tags?.title || basename(path, extname(path)),
  };
}

/**
 * How to identify yourself to the platform, when it asks. This is not a way
 * around a protection: it is how you watch a public video that a signed-out
 * request gets refused, using the session you already have in your browser.
 */
export interface CookieSource {
  /** Browser to read cookies from — chrome, safari, firefox, edge, brave. */
  fromBrowser?: string;
  /** Path to a cookies.txt file, for when reading the browser is not an option. */
  file?: string;
}

/** The yt-dlp flags for a cookie source; nothing when there is none. */
function cookieArgs(cookies?: CookieSource): string[] {
  if (cookies?.fromBrowser) return ["--cookies-from-browser", cookies.fromBrowser];
  if (cookies?.file) return ["--cookies", cookies.file];
  return [];
}

/**
 * Whether the platform refused because it wants to know who is asking, rather
 * than because the content is protected. YouTube answers a signed-out request
 * with a bot check, which reads like a hard failure but is undone by passing
 * your own cookies.
 */
function wantsSignIn(err: unknown): boolean {
  return /sign in to confirm|not a bot|--cookies/i.test(String((err as Error)?.message ?? err));
}

/** True when the input names a platform URL rather than a local file. */
export const isUrl = (input: string) => /^https?:\/\//i.test(input);

/**
 * Queries the platform and translates yt-dlp's JSON into the project's shape.
 * The single place that knows yt-dlp's field names.
 */
export async function fetchSourceInfo(url: string, cookies?: CookieSource): Promise<SourceInfo> {
  const d = JSON.parse(await run("yt-dlp",
    ["--dump-single-json", "--no-warnings", "--no-playlist", ...cookieArgs(cookies), url]));
  return {
    title: d.title ?? "video",
    duration: d.duration != null ? Number(d.duration) : undefined,
    url: d.webpage_url ?? url,
    uploader: d.uploader ?? d.channel,
    uploaderUrl: d.uploader_url ?? d.channel_url,
    uploadDate: d.upload_date,
    license: d.license,
    description: d.description,
    chapters: (d.chapters ?? [])
      .map((c: any): Chapter => ({ start: Number(c.start_time ?? 0), title: String(c.title ?? "").trim() }))
      .filter((c: Chapter) => c.title),
  };
}

/**
 * Called as soon as the title is known — before any download. Throwing from
 * here aborts ingestion without spending bandwidth.
 */
export type OnTitle = (title: string) => void;

/**
 * Downloads a video from a public platform via yt-dlp.
 * yt-dlp does not work around DRM: protected sources fail here by design.
 */
async function fromUrl(
  url: string,
  workDir: string,
  log: (m: string) => void,
  onTitle?: OnTitle,
  cookies?: CookieSource,
): Promise<SourceMeta> {
  log("fetching metadata from the URL...");
  let info: SourceInfo;
  try {
    info = await fetchSourceInfo(url, cookies);
  } catch (err) {
    // Two different failures used to share one message, and it sent people
    // looking for a local copy of a video they could simply have signed in for.
    throw new Error(
      wantsSignIn(err)
        ? `the platform wants to know who is asking.\n\n` +
          `This is a bot check, not protected content — the same video plays for you signed in. ` +
          `Pass the session you already have:\n` +
          `  ${CMD} <url> --cookies-from-browser chrome\n\n` +
          `Works with chrome, safari, firefox, edge or brave. A cookies.txt file also does:\n` +
          `  ${CMD} <url> --cookies ./cookies.txt\n\nTechnical detail: ${firstLine(err)}`
        : `could not read that URL.\n\n` +
          `Paid course platforms usually rely on DRM or require an authenticated session, and this tool ` +
          `works around neither. In that case, use a local file you have the right to access:\n` +
          `  ${CMD} ./aula.mp4\n\nTechnical detail: ${firstLine(err)}`,
    );
  }

  onTitle?.(info.title);

  const out = join(workDir, "source.%(ext)s");
  log(`downloading "${info.title}"...`);
  await run("yt-dlp", [
    "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "--merge-output-format", "mp4",
    "--no-playlist", "--no-warnings",
    ...cookieArgs(cookies),
    "-o", out, url,
  ], { onStderr: (l) => { if (l.includes("%")) log(l.trim()); } });

  const glob = new Bun.Glob("source.*");
  const files = [...glob.scanSync({ cwd: workDir, absolute: true })];
  const videoPath = files.find((f) => /\.(mp4|mkv|webm|mov)$/i.test(f));
  if (!videoPath) throw new Error("the download finished but no video file was found");

  return {
    ...info,
    videoPath,
    duration: info.duration ?? (await probe(videoPath)).duration,
  };
}

/** Resolves the input (URL or path) into a local video with metadata. */
export async function ingest(
  input: string,
  workDir: string,
  log: (m: string) => void,
  onTitle?: OnTitle,
  cookies?: CookieSource,
): Promise<SourceMeta> {
  if (isUrl(input)) return fromUrl(input, workDir, log, onTitle, cookies);

  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  log("reading local file...");
  const { duration, title } = await probe(path);
  onTitle?.(title);
  return { videoPath: path, title, duration };
}
