/** Plumbing shared by the entrypoints: argv, failure, help, paths and browser. */

import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, relative, resolve as resolvePath } from "node:path";
import { notesExists, resolve as resolveAgent, runAgent } from "./agents.ts";
import { renderPage } from "./page.ts";
import { has, run } from "./shell.ts";

/**
 * Where vaults are created, and what paths are shown relative to: the directory
 * the command was run from, never where the code lives. Installed globally the
 * package sits inside node_modules — writing vaults there would need root on a
 * global install, and the next update would wipe them.
 */
export const WORK_DIR = process.cwd();

/** Where the vaults are created and looked for. */
export const VAULTS_DIR = join(WORK_DIR, "vaults");

/**
 * The logo at the top of a run. Goes to stderr, beside the progress log, so a
 * redirect of the vault output never collects it — and only on a TTY, the same
 * rule the help follows.
 */
export function header(): void {
  if (!process.stderr.isTTY) return;
  console.error(BANNER);
}

export function fail(message: string): never {
  console.error(`\x1b[31merror:\x1b[0m ${message}`);
  process.exit(1);
}

/** Reports a failure that already aborted the command, without exiting. */
export function reportFailure(err: unknown): void {
  console.error(`\n\x1b[31mfailed:\x1b[0m ${(err as Error).message}\n`);
}

const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * The logo: a decanter beside the wordmark. Printed only on a TTY, so piping
 * the help into a file or a pager does not collect escape codes.
 */
const BANNER = `
${CYAN}       ╭───╮${RESET}
${CYAN}       │   │${RESET}
${CYAN}      ╭╯   ╰╮        ██████╗ ███████╗ ██████╗ █████╗ ███╗   ██╗████████╗${RESET}
${CYAN}     ╱       ╲       ██╔══██╗██╔════╝██╔════╝██╔══██╗████╗  ██║╚══██╔══╝${RESET}
${CYAN}    ╱ ░░░░░░░ ╲      ██║  ██║█████╗  ██║     ███████║██╔██╗ ██║   ██║${RESET}
${CYAN}   │ ░░░░░░░░░ │     ██║  ██║██╔══╝  ██║     ██╔══██║██║╚██╗██║   ██║${RESET}
${CYAN}   │▒▒▒▒▒▒▒▒▒▒▒│     ██████╔╝███████╗╚██████╗██║  ██║██║ ╚████║   ██║${RESET}
${CYAN}   │▓▓▓▓▓▓▓▓▓▓▓│     ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝${RESET}
${CYAN}   ╰───────────╯${RESET}     ${DIM}video lessons, distilled into study documents${RESET}
`;

/** With no arguments, or with -h/--help, prints the help and exits. */
export function helpOrExit(argv: string[], help: string): void {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    if (process.stdout.isTTY) console.log(BANNER);
    console.log(help);
    process.exit(argv.length === 0 ? 1 : 0);
  }
}

type Manager = "brew" | "apt" | "dnf" | "pacman" | "winget";

/**
 * winget installs one id per command; the others take a whole list, so a single
 * line covers every missing tool.
 */
const MANAGERS: Record<Manager, { bin: string; install: (packages: string[]) => string[] }> = {
  brew: { bin: "brew", install: (p) => [`brew install ${p.join(" ")}`] },
  apt: { bin: "apt-get", install: (p) => [`sudo apt install ${p.join(" ")}`] },
  dnf: { bin: "dnf", install: (p) => [`sudo dnf install ${p.join(" ")}`] },
  pacman: { bin: "pacman", install: (p) => [`sudo pacman -S ${p.join(" ")}`] },
  winget: { bin: "winget", install: (p) => p.map((id) => `winget install -e --id ${id}`) },
};

/** Which package carries each binary. ffmpeg and ffprobe ship together. */
const PACKAGES: Record<string, Partial<Record<Manager, string>>> = {
  ffmpeg: { brew: "ffmpeg", apt: "ffmpeg", dnf: "ffmpeg", pacman: "ffmpeg", winget: "Gyan.FFmpeg" },
  ffprobe: { brew: "ffmpeg", apt: "ffmpeg", dnf: "ffmpeg", pacman: "ffmpeg", winget: "Gyan.FFmpeg" },
  "whisper-cli": { brew: "whisper-cpp" },
  "yt-dlp": { brew: "yt-dlp", apt: "yt-dlp", dnf: "yt-dlp", pacman: "yt-dlp", winget: "yt-dlp.yt-dlp" },
};

/**
 * A binary nobody packages for this platform: the upstream build is the way in.
 * whisper.cpp is only in Homebrew; everywhere else it is compiled.
 */
const FROM_SOURCE: Record<string, string[]> = {
  "whisper-cli": [
    "whisper.cpp has no package here — build it:",
    "  git clone https://github.com/ggml-org/whisper.cpp",
    "  cd whisper.cpp && cmake -B build && cmake --build build --config Release",
    "  then put build/bin/whisper-cli in your PATH",
  ],
};

/**
 * macOS and Windows have one obvious package manager; Linux does not, so the
 * one actually installed decides. The probe only runs once something is already
 * missing, and falls back to the platform's usual manager when none answers.
 */
function packageManager(): Manager {
  const candidates: Manager[] =
    process.platform === "darwin" ? ["brew"]
    : process.platform === "win32" ? ["winget"]
    : ["apt", "dnf", "pacman", "brew"];
  return candidates.find((m) => has(MANAGERS[m].bin)) ?? candidates[0]!;
}

/** Stops with a single message naming every missing binary and how to get it. */
export function requireBinaries(...names: string[]): void {
  const missing = names.filter((name) => !has(name));
  if (missing.length === 0) return;

  const manager = packageManager();
  const packaged = [...new Set(
    missing.map((name) => PACKAGES[name]?.[manager]).filter((pkg) => pkg !== undefined),
  )];

  const steps = packaged.length ? MANAGERS[manager].install(packaged) : [];
  for (const name of missing) {
    if (PACKAGES[name]?.[manager] !== undefined) continue;
    steps.push(...(FROM_SOURCE[name] ?? [`install \`${name}\` and put it in PATH`]));
  }

  fail(
    `not found in PATH: ${missing.join(", ")}\n\n` +
    `Install with:\n${steps.map((step) => `  ${step}`).join("\n")}`,
  );
}

/**
 * The argv grammar every entrypoint shares: options in any order, then a single
 * positional. `handle` consumes the options the command knows — returning true
 * when it took the argument — and calls `next()` for an option's value.
 */
export function parseOptions(
  argv: string[],
  what: string,
  handle: (arg: string, next: () => string) => boolean,
): string {
  let positional = "";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`option ${arg} expects a value`);
      return value;
    };

    if (handle(arg, next)) continue;
    if (arg.startsWith("-")) fail(`unknown option: ${arg}`);
    if (positional) fail(`give only one ${what}`);
    positional = arg;
  }

  return positional;
}

/**
 * Resolves the given path into an absolute vault directory, requiring the file
 * that the command actually needs. `hint` tells the user how to produce what is
 * missing.
 */
export function resolveVault(input: string, requiredFile: string, hint = ""): string {
  const dir = resolvePath(input);
  if (!existsSync(dir)) fail(`vault not found: ${dir}`);
  if (!existsSync(join(dir, requiredFile))) {
    fail(`\`${requiredFile}\` does not exist in ${input}${hint ? `\n\n${hint}` : ""}`);
  }
  return dir;
}

/** Relative path when it is shorter; absolute when it would escape the base directory. */
export function displayPath(target: string, from = process.cwd()): string {
  const rel = relative(from, target);
  return rel.startsWith("..") ? target : rel;
}

/**
 * Opens the file in the system's default browser.
 *
 * On Windows `start` is a cmd builtin rather than a binary, so it is invoked
 * through cmd — and its first argument is the window title, hence the empty one
 * before the path.
 */
export async function openInBrowser(path: string): Promise<void> {
  const [opener, args]: [string, string[]] =
    process.platform === "darwin" ? ["open", [path]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", path]]
    : ["xdg-open", [path]];
  try {
    await run(opener, args);
  } catch {
    console.log(`open it manually: file://${path}`);
  }
}

/** Renders a markdown file from the vault as HTML next to it and returns the generated path. */
export async function renderToFile(vaultDir: string, file: string, standalone = false): Promise<string> {
  const out = join(vaultDir, file.replace(/\.md$/i, "") + ".html");
  await writeFile(out, await renderPage({ vaultDir, file, standalone }));
  return out;
}

/**
 * Hands the vault to an agent so it writes the NOTES.md, and says whether it
 * did. The analysis step of `decant --claude` and of `analyze` is the same one;
 * only the exit policy around it differs, and that stays with the caller.
 */
export async function runAnalysis(
  agentId: string,
  vaultDir: string,
  rel: string,
  announce: (message: string) => void,
): Promise<boolean> {
  const spec = resolveAgent(agentId);
  announce(`${spec.label} will write ${rel}/NOTES.md`);
  console.log();

  await runAgent(spec, rel);

  if (await notesExists(vaultDir)) {
    console.log(`\n\x1b[32mNOTES.md written\x1b[0m — \x1b[1m${rel}/NOTES.md\x1b[0m\n`);
    return true;
  }
  console.log(`\n\x1b[33mthe agent finished, but ${rel}/NOTES.md was not created.\x1b[0m\n`);
  return false;
}
