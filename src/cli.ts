#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { ingest, isUrl, slugify, type CookieSource } from "./lib/ingest.ts";
import { ensureModel, extractAudio, transcribe, MODELS, type ModelName } from "./lib/transcribe.ts";
import { extractFrames, DEFAULT_FRAME_OPTIONS, type FrameOptions } from "./lib/frames.ts";
import { writeBrief } from "./lib/brief.ts";
import { stamp } from "./lib/time.ts";
import {
  CMD, displayPath, fail, header, helpOrExit, openInBrowser, parseOptions, renderToFile,
  WORK_DIR, reportFailure, requireBinaries, runAnalysis, VAULTS_DIR,
} from "./lib/cli.ts";
import { installed, parseAgentFlag, validateAgentId } from "./lib/agents.ts";

/**
 * The subcommands are separate entrypoints that do their work on import. Taking
 * the name out of argv and importing the module hands it exactly the arguments
 * it already knows how to parse, with no wrapper to keep in sync.
 */
const SUBCOMMANDS: Record<string, string> = {
  view: "./view.ts",
  analyze: "./analyze.ts",
  credits: "./credits.ts",
};

const subcommand = SUBCOMMANDS[process.argv[2] ?? ""];
if (subcommand) process.argv.splice(2, 1);

const HELP = `
decant — turns video lessons into study material

USAGE
  ${CMD} <url-or-file> [options]

COMMANDS
  ${CMD} <url-or-file>     process a video into a vault (the default)
  ${CMD} view <vault>      render a document and open it in the browser
  ${CMD} analyze <vault>   rewrite the NOTES.md without reprocessing the video
  ${CMD} credits <vault>   rebuild CREDITS.md and RESOURCES.md from the source

  Each takes -h for its own options.

OPTIONS
  --model <name>    small | medium | turbo | large        (default: turbo)
  --lang <code>     spoken language: auto, pt, en, es     (default: auto)
  --frames <n>      cap on captures in the document       (default: 40)
  --sens <1-64>     sensitivity to screen changes         (default: 10)
                    lower = more captures; 6 for code screencasts
  --sample <fps>    samples per second in the sweep       (default: 0.5)
  --width <px>      width of the captures in pixels       (default: 1280)
  --name <slug>     name of the output vault
  --force           replaces an existing vault, deleting the previous one
  --keep-media      keeps the raw video and audio
  --cookies-from-browser <name>
                    chrome | safari | firefox | edge | brave — for a platform
                    that asks who is asking (YouTube's bot check)
  --cookies <file>  same, from a cookies.txt file
  -h, --help        this help

AUTOMATIC ANALYSIS
  Without any of these flags, the vault is generated and the analysis is up to you.
  With one of them, the agent is called at the end and writes the NOTES.md itself.
  They all run under the CLI's own subscription — no API key.

  --claude          analyse with Claude Code
  --codex           analyse with Codex CLI
  --gemini          analyse with Gemini CLI
  --agent <name>    claude | codex | gemini | auto (first one installed)
  --view            renders the NOTES.md and opens it in the browser at the end

EXAMPLES
  ${CMD} ./aula-01.mp4
  ${CMD} "https://youtube.com/watch?v=..." --lang pt
  ${CMD} ./modulo.mp4 --model large --frames 60 --sens 6
  ${CMD} ./aula.mp4 --claude
  ${CMD} "https://youtu.be/..." --agent auto

Sources with DRM or an authenticated session are not supported by design.
For paid-platform content, use a local file you have the right to access.
`;

interface Args {
  input: string;
  model: ModelName;
  lang: string;
  frameOpts: FrameOptions;
  name?: string;
  force: boolean;
  keepMedia: boolean;
  agent?: string;
  view: boolean;
  cookies?: CookieSource;
}

function parseArgs(argv: string[]): Args {
  helpOrExit(argv, HELP);

  const args: Args = {
    input: "",
    model: "turbo",
    lang: "auto",
    frameOpts: { ...DEFAULT_FRAME_OPTIONS },
    force: false,
    keepMedia: false,
    view: false,
  };

  args.input = parseOptions(argv, "video source", (arg, next) => {
    switch (arg) {
      case "--model": {
        const m = next();
        if (!(m in MODELS)) fail(`invalid model: ${m} (use ${Object.keys(MODELS).join(", ")})`);
        args.model = m as ModelName;
        return true;
      }
      case "--lang": args.lang = next(); return true;
      case "--frames": args.frameOpts.maxFrames = Number(next()); return true;
      case "--sens": args.frameOpts.changeThreshold = Number(next()); return true;
      case "--sample": args.frameOpts.sampleFps = Number(next()); return true;
      case "--width": args.frameOpts.width = Number(next()); return true;
      case "--name": args.name = next(); return true;
      case "--force": args.force = true; return true;
      case "--keep-media": args.keepMedia = true; return true;
      case "--cookies-from-browser": args.cookies = { fromBrowser: next() }; return true;
      case "--cookies": args.cookies = { file: next() }; return true;
      case "--agent": args.agent = next(); return true;
      case "--view": args.view = true; return true;
      default: {
        const agent = parseAgentFlag(arg);
        if (!agent) return false;
        args.agent = agent;
        return true;
      }
    }
  });

  const { maxFrames, changeThreshold, sampleFps } = args.frameOpts;
  if (!args.input) fail("give the URL or the path to the video");
  if (!Number.isFinite(maxFrames) || maxFrames < 1) fail("--frames must be a positive integer");
  if (!Number.isFinite(changeThreshold) || changeThreshold < 1 || changeThreshold > 64) fail("--sens must be between 1 and 64");
  if (!Number.isFinite(sampleFps) || sampleFps <= 0 || sampleFps > 10) fail("--sample must be between 0 and 10");

  const invalid = args.agent && validateAgentId(args.agent);
  if (invalid) fail(invalid);
  return args;
}

/** Renders a markdown file from the vault as HTML and opens it in the browser. */
async function openDocument(vaultDir: string, rel: string, file: string): Promise<void> {
  const out = await renderToFile(vaultDir, file);
  console.log(`\x1b[2mrendered ${rel}/${basename(out)}\x1b[0m`);
  await openInBrowser(out);
}

/** Moves the file into the directory, without copying bytes when possible. */
async function moveInto(dir: string, src: string): Promise<void> {
  const dest = join(dir, basename(src));
  try {
    await rename(src, dest);
  } catch {
    // Different volumes: renaming is not possible, only copying.
    await Bun.write(dest, Bun.file(src));
  }
}

const started = Date.now();
const elapsed = () => stamp((Date.now() - started) / 1000);
const log = (msg: string) => console.error(`\x1b[2m[${elapsed()}]\x1b[0m ${msg}`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  header();
  requireBinaries("ffmpeg", "ffprobe", "whisper-cli", ...(isUrl(args.input) ? ["yt-dlp"] : []));

  const staging = join(VAULTS_DIR, ".staging");

  // Declared out here so the finally can wipe it. It holds the extracted audio,
  // which is the largest thing this ever writes.
  let workDir = "";

  /**
   * Decides the destination vault and refuses to collide with an existing one.
   *
   * Reprocessing on top wipes the frames and resets CREDITS.md/RESOURCES.md to
   * their blank state, but leaves the NOTES.md behind — the document survives
   * pointing at images whose content changed or that are gone. Rather than
   * producing that inconsistent vault, we stop and leave the choice explicit.
   */
  const claimVault = (title: string): string => {
    const dir = join(VAULTS_DIR, slugify(args.name ?? title));
    if (existsSync(dir) && !args.force) {
      const rel = displayPath(dir, WORK_DIR);
      throw new Error(
        `a vault already exists at ${rel}\n\n` +
        `  re-analyse without reprocessing the video:  ${CMD} analyze ${rel} --claude\n` +
        `  generate a sibling under another name:      ${CMD} <source> --name <slug>\n` +
        `  discard the previous one and redo it:       ${CMD} <source> --force\n\n` +
        `\x1b[2m--force deletes the whole vault, NOTES.md and collected credits included.\x1b[0m`,
      );
    }
    return dir;
  };

  try {
    // With --name the destination is already known: refuse before downloading anything.
    if (args.name) claimVault(args.name);

    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });

    // The model does not depend on the video: the first run downloads ~1.5 GB,
    // and nothing stops that from running alongside the download and the audio
    // extraction. It starts only past the checks above, which refuse for free.
    void ensureModel(args.model, log).catch(() => { /* the error surfaces again on transcribe's await */ });

    // 1. Resolve the source into a local file with metadata. The check runs
    //    again as soon as the title shows up, still before the download.
    const source = await ingest(args.input, staging, log, claimVault, args.cookies);
    log(`"${source.title}" — ${stamp(source.duration)}`);

    // Now that the title is known, the vault gets its final name.
    const vaultDir = claimVault(source.title);
    if (args.force) await rm(vaultDir, { recursive: true, force: true });
    workDir = join(vaultDir, ".work");
    await mkdir(workDir, { recursive: true });

    // 2. Transcription and frame capture are independent: they run together.
    const audioPath = join(workDir, "audio.wav");
    const [{ segments, language }, frames] = await Promise.all([
      extractAudio(source.videoPath, audioPath, log)
        .then((wav) => transcribe(wav, { model: args.model, lang: args.lang, workDir, log })),
      extractFrames(source.videoPath, vaultDir, args.frameOpts, log),
    ]);

    // 3. Assemble the package that feeds the analysis.
    log("assembling the analysis package...");
    const rel = displayPath(vaultDir, WORK_DIR);
    await writeBrief({ vaultDir, vaultRel: rel, source, segments, frames, language });

    if (args.keepMedia) {
      const media = join(vaultDir, "media");
      await mkdir(media, { recursive: true });
      await moveInto(media, audioPath);
      // A downloaded video lives in staging, which the finally block wipes.
      if (source.videoPath.startsWith(staging)) await moveInto(media, source.videoPath);
    }
    console.log(`
\x1b[32mvault ready in ${elapsed()}\x1b[0m — \x1b[1m${rel}\x1b[0m
  ${segments.length} segments · ${frames.length} frames
`);

    // 4. Analysis: only happens when asked for by a flag.
    if (!args.agent) {
      const flags = installed().map((a) => `--${a.id}`).join(", ") || "no agent installed";
      if (args.view) await openDocument(vaultDir, rel, "BRIEF.md");
      console.log(`Write the NOTES.md by asking Claude Code:
  \x1b[36manalisa o vault ${rel} e escreve o NOTES.md\x1b[0m

Or make it automatic next time: ${flags}
`);
      return;
    }

    if (await runAnalysis(args.agent, vaultDir, rel, log) && args.view) {
      await openDocument(vaultDir, rel, "NOTES.md");
    }
  } catch (err) {
    reportFailure(err);
    // exitCode instead of exit(): process.exit() here would skip the finally and
    // leave the downloaded video behind in staging.
    process.exitCode = 1;
  } finally {
    // Both paths, not just the happy one: an interrupted run used to leave the
    // extracted audio behind — 26MB for a short lesson — inside a half-built
    // vault that then refused to be rebuilt without --force.
    await rm(staging, { recursive: true, force: true });
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}

if (subcommand) {
  await import(subcommand);
} else {
  await main();
}
