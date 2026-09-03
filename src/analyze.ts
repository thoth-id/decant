#!/usr/bin/env bun
import { NoAgentsError, parseAgentFlag, validateAgentId } from "./lib/agents.ts";
import {
  displayPath, fail, helpOrExit, parseOptions, WORK_DIR, reportFailure, resolveVault, runAnalysis,
} from "./lib/cli.ts";

const HELP = `
analyze — runs the analysis on an already processed vault

USAGE
  bun run analyze <vault> [--claude | --codex | --gemini | --agent <name>]

Reuses the transcript and the frames that already exist: no video is
reprocessed. Useful to rewrite the NOTES.md or to compare agents.

EXAMPLES
  bun run analyze vaults/minha-aula --claude
  bun run analyze vaults/minha-aula --gemini
`;

const argv = process.argv.slice(2);
helpOrExit(argv, HELP);

let agent = "auto";
const vault = parseOptions(argv, "vault", (arg, next) => {
  if (arg === "--agent") { agent = next(); return true; }
  const flagged = parseAgentFlag(arg);
  if (!flagged) return false;
  agent = flagged;
  return true;
});

if (!vault) fail("give the vault directory");
const invalid = validateAgentId(agent);
if (invalid) fail(invalid);

const dir = resolveVault(vault, "transcript.md", "Generate a vault with: bun run decant <video>");

// The agent runs from the repository root, so that is the path it understands;
// a vault outside the repo would produce "../../.." and goes absolute instead.
const rel = displayPath(dir, WORK_DIR);

try {
  if (!(await runAnalysis(agent, dir, rel, (m) => console.error(`\x1b[2m${m}\x1b[0m`)))) {
    process.exit(1);
  }
} catch (err) {
  reportFailure(err);
  // "nothing to run" is worth its own code: a caller can install an agent and retry.
  process.exit(err instanceof NoAgentsError ? 2 : 1);
}
