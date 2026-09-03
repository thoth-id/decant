#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  displayPath, fail, helpOrExit, openInBrowser, parseOptions, renderToFile, resolveVault,
} from "./lib/cli.ts";

const HELP = `
view — renders a vault's document and opens it in the browser

USAGE
  bun run view <vault> [options]

OPTIONS
  --file <name>   markdown to render           (default: NOTES.md)
  --standalone    embeds the images in the HTML (single file, sendable)
  --no-open       only generates the file, does not open it
  -h, --help      this help

EXAMPLES
  bun run view vaults/minha-aula
  bun run view vaults/minha-aula --file BRIEF.md
  bun run view vaults/minha-aula --standalone   # to send to someone
`;

const argv = process.argv.slice(2);
helpOrExit(argv, HELP);

let file = "NOTES.md";
let standalone = false;
let open = true;

const vault = parseOptions(argv, "vault", (arg, next) => {
  switch (arg) {
    case "--file": file = next(); return true;
    case "--standalone": standalone = true; return true;
    case "--no-open": open = false; return true;
    default: return false;
  }
});

if (!vault) fail("give the vault directory");

// Vault already processed but not yet analysed: point the way to producing it.
const hint = file === "NOTES.md" && existsSync(join(vault, "BRIEF.md"))
  ? `The vault has no NOTES.md yet. Generate the analysis with:\n  bun run analyze ${vault} --claude\n\nOr look at the raw package:\n  bun run view ${vault} --file BRIEF.md`
  : "";
const dir = resolveVault(vault, file, hint);

const out = await renderToFile(dir, file, standalone);
const size = (Bun.file(out).size / 1024).toFixed(0);
console.log(`\x1b[32mgenerated\x1b[0m \x1b[1m${displayPath(out)}\x1b[0m (${size}KB)`);

if (open) await openInBrowser(out);
