import { existsSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { AttributionSource } from "./credits.ts";
import type { Chapter } from "./resources.ts";
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

/** True when the input names a platform URL rather than a local file. */
export const isUrl = (input: string) => /^https?:\/\//i.test(input);

/**
 * Queries the platform and translates yt-dlp's JSON into the project's shape.
 * The single place that knows yt-dlp's field names.
 */
export async function fetchSourceInfo(url: string): Promise<SourceInfo> {
  const d = JSON.parse(await run("yt-dlp", ["--dump-single-json", "--no-warnings", "--no-playlist", url]));
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
async function fromUrl(url: string, workDir: string, log: (m: string) => void, onTitle?: OnTitle): Promise<SourceMeta> {
  log("fetching metadata from the URL...");
  let info: SourceInfo;
  try {
    info = await fetchSourceInfo(url);
  } catch (err) {
    throw new Error(
      `could not read that URL.\n\n` +
      `Paid course platforms usually rely on DRM or require an authenticated session, and this tool ` +
      `works around neither. In that case, use a local file you have the right to access:\n` +
      `  bun run decant ./aula.mp4\n\nTechnical detail: ${firstLine(err)}`,
    );
  }

  onTitle?.(info.title);

  const out = join(workDir, "source.%(ext)s");
  log(`downloading "${info.title}"...`);
  await run("yt-dlp", [
    "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
    "--merge-output-format", "mp4",
    "--no-playlist", "--no-warnings",
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
): Promise<SourceMeta> {
  if (isUrl(input)) return fromUrl(input, workDir, log, onTitle);

  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  log("reading local file...");
  const { duration, title } = await probe(path);
  onTitle?.(title);
  return { videoPath: path, title, duration };
}
