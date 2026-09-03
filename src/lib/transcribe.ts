import { existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { homedir, cpus } from "node:os";
import { join } from "node:path";
import { run } from "./shell.ts";

export interface Segment {
  /** Start and end, in seconds. */
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  segments: Segment[];
  /** Spoken language: the one requested, or the one whisper detected with "auto". */
  language: string;
}

/** Supported ggml models, from lightest to most accurate. */
export const MODELS = {
  small: "ggml-small.bin",
  medium: "ggml-medium.bin",
  turbo: "ggml-large-v3-turbo.bin",
  large: "ggml-large-v3.bin",
} as const;
export type ModelName = keyof typeof MODELS;

const MODEL_DIR = join(homedir(), ".cache", "decant", "models");
const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

const inFlight = new Map<ModelName, Promise<string>>();

/**
 * Makes sure the model is cached, downloading it from HuggingFace the first time.
 *
 * The result is memoized so the download can be kicked off in parallel with
 * audio extraction without `transcribe` repeating it.
 */
export function ensureModel(name: ModelName, log: (m: string) => void): Promise<string> {
  let pending = inFlight.get(name);
  if (!pending) {
    pending = download(name, log);
    inFlight.set(name, pending);
  }
  return pending;
}

async function download(name: ModelName, log: (m: string) => void): Promise<string> {
  const file = MODELS[name];
  const path = join(MODEL_DIR, file);
  if (existsSync(path)) return path;

  await mkdir(MODEL_DIR, { recursive: true });
  log(`downloading model "${name}" (first time only)...`);

  const res = await fetch(`${HF_BASE}/${file}`);
  if (!res.ok || !res.body) throw new Error(`failed to download model ${name}: HTTP ${res.status}`);

  const total = Number(res.headers.get("content-length") ?? 0);
  const tmp = `${path}.part`;
  const sink = Bun.file(tmp).writer();
  let done = 0;
  let lastPct = -1;

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    sink.write(chunk);
    done += chunk.byteLength;
    const pct = total ? Math.floor((done / total) * 100) : 0;
    if (total && pct >= lastPct + 5) { lastPct = pct; log(`  model ${pct}%`); }
  }
  await sink.end();
  await rename(tmp, path);
  return path;
}

/** Extracts audio in the format whisper.cpp requires: WAV PCM 16 kHz mono. */
export async function extractAudio(videoPath: string, outPath: string, log: (m: string) => void): Promise<string> {
  log("extracting audio...");
  await run("ffmpeg", [
    "-nostdin", "-y", "-i", videoPath,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
    outPath,
  ]);
  return outPath;
}

/**
 * Transcribes locally with whisper.cpp (Metal on Apple Silicon).
 * With `lang: "auto"` whisper itself identifies the spoken language.
 */
export async function transcribe(
  audioPath: string,
  opts: { model: ModelName; lang: string; workDir: string; log: (m: string) => void },
): Promise<Transcript> {
  const { model, lang, workDir, log } = opts;
  const modelPath = await ensureModel(model, log);
  const prefix = join(workDir, "transcript");

  log(`transcribing with whisper (${model})...`);
  await run("whisper-cli", [
    "-m", modelPath,
    "-f", audioPath,
    "-l", lang,
    "-t", String(Math.max(1, cpus().length - 2)),
    "--output-json", "--no-prints",
    "-of", prefix,
  ], {
    onStderr: (line) => {
      const m = line.match(/progress\s*=\s*(\d+)%/);
      if (m) log(`  transcription ${m[1]}%`);
    },
  });

  const raw = await Bun.file(`${prefix}.json`).json();
  const segments: Segment[] = (raw.transcription ?? []).map((s: any) => ({
    start: (s.offsets?.from ?? 0) / 1000,
    end: (s.offsets?.to ?? 0) / 1000,
    text: String(s.text ?? "").trim(),
  })).filter((s: Segment) => s.text.length > 0);

  if (segments.length === 0) throw new Error("the transcript came out empty — does the video have an audio track?");

  const language = String(raw.result?.language || lang);
  if (lang === "auto") log(`detected language: ${language}`);
  return { segments, language };
}
