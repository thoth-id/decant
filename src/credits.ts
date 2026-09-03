#!/usr/bin/env bun
import { fetchSourceInfo, type CookieSource } from "./lib/ingest.ts";
import { buildCredits, writeAttribution, type Credits } from "./lib/credits.ts";
import { isMaterial, type Chapter } from "./lib/resources.ts";
import { CMD, displayPath, fail, helpOrExit, parseOptions, resolveVault } from "./lib/cli.ts";
import { readMeta, writeMeta } from "./lib/vault.ts";
import { firstLine, has } from "./lib/shell.ts";

const HELP = `
credits — (re)generates a vault's CREDITS.md

USAGE
  ${CMD} credits <vault> [--offline] [--cookies-from-browser <name>]

Queries the source platform to recover authorship, date, license and the links
in the description. Does not download video. With --offline, uses only what is
already in meta.json.

EXAMPLES
  ${CMD} credits vaults/minha-aula
  ${CMD} credits vaults/minha-aula --offline
`;

const argv = process.argv.slice(2);
helpOrExit(argv, HELP);

let offline = false;
let cookies: CookieSource | undefined;
const vault = parseOptions(argv, "vault", (arg, next) => {
  switch (arg) {
    case "--offline": offline = true; return true;
    case "--cookies-from-browser": cookies = { fromBrowser: next() }; return true;
    case "--cookies": cookies = { file: next() }; return true;
    default: return false;
  }
});
if (!vault) fail("give the vault directory");

const dir = resolveVault(vault, "meta.json");
const meta = await readMeta(dir);
if (!meta) fail(`unreadable meta.json in ${vault}`);

// Offline — and every path that fails to reach the platform — reuses the credits
// meta.json already holds. Rebuilding them from its four top-level fields would
// drop the author URL, the date, the license and every link in the description.
let credits: Credits = meta.credits;
let chapters: Chapter[] = meta.chapters;

if (!meta.url) {
  console.error(`\x1b[2mlocal source: credits are left for the analysis to fill in\x1b[0m`);
} else if (!offline) {
  if (!has("yt-dlp")) fail("`yt-dlp` is not in PATH — use --offline");
  console.error(`\x1b[2mquerying the source…\x1b[0m`);
  try {
    const info = await fetchSourceInfo(meta.url, cookies);
    credits = buildCredits(info);
    chapters = info.chapters ?? [];
  } catch (err) {
    console.error(`\x1b[33mwarning:\x1b[0m keeping the credits in meta.json — ${firstLine(err)}`);
  }
}

await writeAttribution(dir, credits, chapters);
await writeMeta(dir, { ...meta, credits, chapters });

console.log(`\x1b[32mCREDITS.md updated\x1b[0m — \x1b[1m${displayPath(dir)}/CREDITS.md\x1b[0m`);
if (credits.author) console.log(`  author: ${credits.author}`);
if (credits.publishedAt) console.log(`  published: ${credits.publishedAt}`);
console.log(`  links in the description: ${credits.links.length} (${credits.links.filter((l) => isMaterial(l.kind)).length} of study material)`);
if (chapters.length) console.log(`  chapters: ${chapters.length}`);
console.log(`\x1b[32mRESOURCES.md updated\x1b[0m`);
