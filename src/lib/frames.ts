import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { run, runBinary } from "./shell.ts";
import { formatFileTime } from "./time.ts";

export interface Frame {
  /** Moment of the frame in the video, in seconds. */
  time: number;
  /** Path relative to the vault directory (used in the markdown). */
  rel: string;
}

export interface FrameOptions {
  /** Samples per second during the analysis sweep. 0.5 = one every 2s. */
  sampleFps: number;
  /**
   * Differing bits (out of 64) before the screen counts as actually changed.
   * Lower = more sensitive. ~10 separates a slide change from video noise well.
   */
  changeThreshold: number;
  /** Minimum interval between two accepted frames, in seconds. */
  minGap: number;
  /** Guaranteed capture every N seconds, even without a change. */
  maxGap: number;
  /** Cap on frames in the final document. */
  maxFrames: number;
  /** Output width in pixels. */
  width: number;
}

export const DEFAULT_FRAME_OPTIONS: FrameOptions = {
  sampleFps: 0.5,
  changeThreshold: 10,
  minGap: 4,
  maxGap: 45,
  maxFrames: 40,
  width: 1280,
};

/** Analysis thumbnail size: 9 columns so each row yields 8 comparisons. */
const HASH_W = 9;
const HASH_H = 8;
const THUMB_BYTES = HASH_W * HASH_H;

/**
 * 64-bit perceptual signature (dHash) from a 9x8 grayscale thumbnail: each bit
 * says whether a pixel is brighter than its right-hand neighbour. It captures
 * the image structure and ignores compression and noise.
 */
function dhash(thumb: Buffer): bigint {
  let hash = 0n;
  for (let row = 0; row < HASH_H; row++) {
    for (let col = 0; col < HASH_W - 1; col++) {
      const i = row * HASH_W + col;
      hash = (hash << 1n) | (thumb[i]! > thumb[i + 1]! ? 1n : 0n);
    }
  }
  return hash;
}

/** Number of differing bits between two hashes: 0 = identical, 64 = opposite. */
function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) { x &= x - 1n; n++; }
  return n;
}

interface Sample { time: number; hash: bigint }

/**
 * Sweeps the whole video in a single pass and returns each sample's signature.
 * ffmpeg emits the raw thumbnails on stdout — 72 bytes per sample, nothing
 * written to disk.
 */
async function sampleVideo(videoPath: string, sampleFps: number): Promise<Sample[]> {
  const raw = await runBinary("ffmpeg", [
    "-nostdin", "-v", "error", "-i", videoPath,
    "-vf", `fps=${sampleFps},scale=${HASH_W}:${HASH_H},format=gray`,
    "-f", "rawvideo", "-",
  ]);

  const samples: Sample[] = [];
  for (let offset = 0, i = 0; offset + THUMB_BYTES <= raw.length; offset += THUMB_BYTES, i++) {
    samples.push({
      time: i / sampleFps,
      hash: dhash(raw.subarray(offset, offset + THUMB_BYTES)),
    });
  }
  return samples;
}

interface Pick { time: number; novelty: number }

/** Two samples closer than this count as the same still screen. */
const SETTLED_BITS = 4;
/** Cap on how long to wait for the screen to settle, in seconds, for video that never stops. */
const MAX_SETTLE_SECONDS = 6;

/**
 * Picks the moments where the screen changed enough to be worth a capture.
 *
 * The change is detected at the start of the transition, but capturing there
 * catches the middle of the animation — a title sliding in, code being typed.
 * So after detecting it, we move forward while the image is still changing and
 * capture once it settles. Video that never stops (handheld camera, gameplay)
 * is protected by the settle cap.
 */
function pickMoments(samples: Sample[], opts: FrameOptions): Pick[] {
  if (samples.length === 0) return [];

  const settleFrom = (start: number): number => {
    let i = start;
    while (
      i + 1 < samples.length &&
      samples[i + 1]!.time - samples[start]!.time <= MAX_SETTLE_SECONDS &&
      hamming(samples[i]!.hash, samples[i + 1]!.hash) > SETTLED_BITS
    ) i++;
    return i;
  };

  const first = settleFrom(0);
  const picks: Pick[] = [{ time: samples[first]!.time, novelty: 64 }];
  let lastHash = samples[first]!.hash;
  let lastTime = samples[first]!.time;

  for (let i = first + 1; i < samples.length; i++) {
    const s = samples[i]!;
    const gap = s.time - lastTime;
    const novelty = hamming(lastHash, s.hash);
    const changed = novelty >= opts.changeThreshold && gap >= opts.minGap;
    const stale = gap >= opts.maxGap;
    if (!changed && !stale) continue;

    const settled = settleFrom(i);
    picks.push({ time: samples[settled]!.time, novelty });
    lastHash = samples[settled]!.hash;
    lastTime = samples[settled]!.time;
    i = settled;
  }
  return picks;
}

/** Grabs a single high-resolution frame at the requested moment. */
async function grab(videoPath: string, time: number, outPath: string, width: number): Promise<void> {
  await run("ffmpeg", [
    "-nostdin", "-v", "error", "-y",
    // -ss before -i seeks by keyframe: fast even on a long video.
    "-ss", time.toFixed(3), "-i", videoPath,
    "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3",
    outPath,
  ]);
}

/** Runs tasks with a concurrency cap. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Captures the relevant frames of the video.
 *
 * Detection does not use ffmpeg's `scene` filter: it was built for camera cuts
 * and scores low on exactly what matters here — slide and code-screen changes.
 * Instead the video is sampled and compared by perceptual signature, which
 * works the same for a recorded class, a screencast and slides.
 */
export async function extractFrames(
  videoPath: string,
  vaultDir: string,
  opts: FrameOptions,
  log: (m: string) => void,
): Promise<Frame[]> {
  const outDir = join(vaultDir, "frames");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  log("sweeping the video for screen changes...");
  const samples = await sampleVideo(videoPath, opts.sampleFps);
  if (samples.length === 0) return [];

  let picks = pickMoments(samples, opts);
  log(`${picks.length} relevant moments across ${samples.length} samples`);

  // Over the cap, keep the moments where the screen changed the most.
  if (picks.length > opts.maxFrames) {
    picks = picks
      .sort((a, b) => b.novelty - a.novelty)
      .slice(0, opts.maxFrames)
      .sort((a, b) => a.time - b.time);
    log(`limited to the ${picks.length} most significant`);
  }

  // The change happened somewhere between two samples, so the detected moment
  // may land slightly before the new screen. Half a sampling interval of margin
  // makes sure we capture the settled content, not the previous frame.
  const margin = 0.5 / opts.sampleFps;
  const lastSample = samples[samples.length - 1]!.time;

  log("capturing at high resolution...");
  const frames = await mapLimit(picks, 4, async (pick, i) => {
    const at = Math.min(pick.time + margin, lastSample);
    const name = `${String(i + 1).padStart(3, "0")}-${formatFileTime(at)}.jpg`;
    await grab(videoPath, at, join(outDir, name), opts.width);
    return { time: at, rel: `frames/${name}` } satisfies Frame;
  });

  log(`${frames.length} frames captured`);
  return frames;
}
