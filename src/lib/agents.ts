import { basename, join } from "node:path";
import { has, run } from "./shell.ts";

export interface AgentSpec {
  id: string;
  label: string;
  /** Binary that has to be in PATH. */
  bin: string;
  /** How to install it, quoted when the binary is missing. */
  install: string;
  /**
   * Arguments to run non-interactively with permission to write files in the
   * working directory — and nothing more than that.
   */
  args: (prompt: string) => string[];
}

/**
 * Supported command-line agents. All of them run under the subscription the
 * user already has on the respective CLI: no API key is involved here.
 */
export const AGENTS: Record<string, AgentSpec> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    bin: "claude",
    install: "npm i -g @anthropic-ai/claude-code",
    // acceptEdits allows writing files without giving up the remaining checks.
    args: (p) => ["-p", p, "--permission-mode", "acceptEdits"],
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    bin: "codex",
    install: "npm i -g @openai/codex",
    args: (p) => ["exec", p, "--sandbox", "workspace-write", "--skip-git-repo-check"],
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    bin: "gemini",
    install: "npm i -g @google/gemini-cli",
    // --skip-trust: without it the CLI downgrades approval-mode in a headless environment.
    args: (p) => ["-p", p, "--approval-mode", "auto_edit", "--skip-trust"],
  },
};

/** Nothing to run: the caller decides whether that deserves its own exit code. */
export class NoAgentsError extends Error {
  constructor() {
    super(
      `no agent found in PATH.\nInstall one of them:\n` +
      Object.values(AGENTS).map((a) => `  ${a.label.padEnd(12)} ${a.install}`).join("\n"),
    );
    this.name = "NoAgentsError";
  }
}

const unknownAgent = (id: string) =>
  `unknown agent: ${id} (use ${Object.keys(AGENTS).join(", ")} or auto)`;

/** Agents actually installed on this machine, in registry order. */
export function installed(): AgentSpec[] {
  return Object.values(AGENTS).filter((a) => has(a.bin));
}

/** Resolves the requested agent; "auto" takes the first installed one. */
export function resolve(id: string): AgentSpec {
  if (id === "auto") {
    const first = installed()[0];
    if (!first) throw new NoAgentsError();
    return first;
  }

  const spec = AGENTS[id];
  if (!spec) throw new Error(unknownAgent(id));
  if (!has(spec.bin)) {
    throw new Error(`\`${spec.bin}\` is not in PATH.\nInstall it with: ${spec.install}`);
  }
  return spec;
}

/**
 * The instruction handed to the agent. The full rules live in AGENTS.md, which
 * Claude Code and Codex discover on their own and Gemini reaches through
 * `.gemini/settings.json`. The essentials are repeated here on purpose, so the
 * prompt still works if the CLI does not load a convention file.
 *
 * The NOTES.md itself is written in Brazilian Portuguese: it is the deliverable
 * the reader studies from, not part of the codebase.
 */
function buildPrompt(vaultRel: string): string {
  const slug = basename(vaultRel);
  return [
    `Read the analysis instructions in AGENTS.md (section "Writing the NOTES.md") and carry them out for the vault \`${vaultRel}\`.`,
    ``,
    `Inputs: \`${vaultRel}/BRIEF.md\`, \`${vaultRel}/transcript.md\`, \`${vaultRel}/meta.json\` and the images in \`${vaultRel}/frames/\`.`,
    `Output: write \`${vaultRel}/NOTES.md\`.`,
    ``,
    `The goal is NOT to transcribe — the transcript already exists and is only raw input.`,
    `Extract teachings, practical tips, code examples, common mistakes and pitfalls.`,
    `Open the frames and read the text on the screens: when the audio gets a symbol name wrong, the screen shows the right one.`,
    `Anchor the points with timestamps; if meta.json has a YouTube "url", use clickable links.`,
    `Embed frames with \`![description](frames/file.jpg)\` only where the image adds something.`,
    `Write the document in Brazilian Portuguese, with correct spelling and accents, and end it with a "Resumo pratico".`,
    ``,
    `CREDITS — mandatory:`,
    `1. Read \`${vaultRel}/CREDITS.md\`. End the NOTES.md with a "## Creditos" section`,
    `   naming the author/channel and linking to the original work.`,
    `2. While analysing, note who is credited in the lesson itself: the name of the`,
    `   teacher or presenter said out loud, names shown on screen (opening, footer,`,
    `   signature), authors cited, books, tools and sources mentioned.`,
    `   Write those names in the "Creditos citados na aula" section of CREDITS.md,`,
    `   replacing the HTML comment that sits there.`,
    `3. Do not invent any name. If there is no mention, write that there was none.`,
    ``,
    `SUPPORTING MATERIALS:`,
    `4. Read \`${vaultRel}/RESOURCES.md\`. If there is useful material, add a`,
    `   "## Materiais complementares" section to the NOTES.md with the links that help studying.`,
    `5. Note what only appears in the content: a URL shown on screen, an address said`,
    `   out loud, a recommended book or article, a tool, an install command,`,
    `   documentation cited, "link in the description". Write it in the "Citados na aula"`,
    `   section of RESOURCES.md, in place of the HTML comment.`,
    `6. If a URL was said but is not legible anywhere, record the resource name and the`,
    `   timestamp instead of guessing the address.`,
    `7. If the vault has declared chapters, use them as the document's skeleton`,
    `   whenever they make didactic sense.`,
    ``,
    `When you are done, answer in a single line: the title given to the document and how many sections it has. Vault: ${slug}.`,
  ].join("\n");
}

/** Translates `--claude`/`--codex`/`--gemini` into the agent id. Null for other flags. */
export function parseAgentFlag(arg: string): string | null {
  const id = arg.startsWith("--") ? arg.slice(2) : "";
  return id in AGENTS ? id : null;
}

/** Validates the id given on the command line. Returns the error message, or null. */
export function validateAgentId(id: string): string | null {
  return id === "auto" || id in AGENTS ? null : unknownAgent(id);
}

/** Runs the agent over the vault, with its output echoed straight to the terminal. */
export async function runAgent(spec: AgentSpec, vaultRel: string): Promise<void> {
  await run(spec.bin, spec.args(buildPrompt(vaultRel)), { inherit: true });
}

/** Whether the agent delivered the NOTES.md. */
export function notesExists(vaultDir: string): Promise<boolean> {
  return Bun.file(join(vaultDir, "NOTES.md")).exists();
}
