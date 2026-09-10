#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { CMD, displayPath, fail, helpOrExit, parseOptions, vaultsDir } from "./lib/cli.ts";
import { firstLine, has, run } from "./lib/shell.ts";
import { createSite, listVaults } from "./lib/site.ts";

const HELP = `
serve — puts the vaults up as a site, to read them from any device

USAGE
  ${CMD} serve [options]

Lists every vault in the vaults directory (./vaults, or DECANT_VAULTS) and
renders its documents on each request: nothing is written to disk, and an
edited NOTES.md shows up on reload. Only this machine can reach it unless a
flag below opens it up.

OPTIONS
  --tailscale     also on your tailnet over HTTPS: any device on it, from any
                  network (needs Tailscale connected)
  --lan           also on the local network, behind a token in the address
  --port <n>      local port                                  (default: 4242)
  -h, --help      this help

EXAMPLES
  ${CMD} serve
  ${CMD} serve --tailscale
  ${CMD} serve --lan --port 8080
`;

const argv = process.argv.slice(2);
// Unlike the other commands, serve needs no argument: an empty argv starts it
// rather than printing the help.
if (argv.length > 0) helpOrExit(argv, HELP);

let port = 4242;
let lan = false;
let tailscale = false;

const extra = parseOptions(argv, "argument", (arg, next) => {
  switch (arg) {
    case "--port": port = Number(next()); return true;
    case "--lan": lan = true; return true;
    case "--tailscale": tailscale = true; return true;
    default: return false;
  }
});
if (extra) fail(`serve takes no vault — it serves every one in the vaults directory (got: ${extra})`);
if (!Number.isInteger(port) || port < 1 || port > 65535) fail("--port must be a whole number between 1 and 65535");

const root = vaultsDir();
if (!(await stat(root).catch(() => null))?.isDirectory()) {
  fail(`no vaults directory at ${displayPath(root)}\n\nRun it where vaults/ lives, or point DECANT_VAULTS at it.`);
}

/**
 * This machine's name on the tailnet, checked before anything starts: serving
 * over HTTPS needs Tailscale connected and certificates turned on, and finding
 * that out later would leave a site half up.
 */
async function tailnetHost(): Promise<string> {
  if (!has("tailscale")) fail("`tailscale` is not in PATH — install Tailscale, or use --lan");

  let status: { BackendState?: string; CertDomains?: string[] | null; Self?: { DNSName?: string } } | undefined;
  try {
    status = JSON.parse(await run("tailscale", ["status", "--json"]));
  } catch (err) {
    fail(`could not read Tailscale's status: ${firstLine(err)}`);
  }
  if (status?.BackendState !== "Running") fail("Tailscale is not connected — bring it up, or use --lan");

  const host = status.Self?.DNSName?.replace(/\.$/, "");
  if (!host || !status.CertDomains?.length) {
    fail("HTTPS certificates are off on this tailnet — turn them on in the admin console (DNS page), or use --lan");
  }
  return host;
}

/**
 * Puts the local port on the tailnet with `tailscale serve` in the foreground,
 * so the address lives exactly as long as this command: `--bg` would outlive a
 * crash and leave the vaults on the tailnet until someone noticed.
 *
 * The child leads a process group of its own and is stopped through the group.
 * On macOS the `tailscale` in PATH is a shell script that runs the app's binary
 * as its own child and passes no signal on — stopping the script alone leaves
 * the real one serving. Resolves once Tailscale reports the address.
 */
function serveOnTailnet(port: number, host: string): Promise<void> {
  const child = spawn("tailscale", ["serve", String(port)], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let stopping = false;
  process.on("exit", () => {
    stopping = true;
    if (!child.pid) return;
    try {
      process.kill(-child.pid, "SIGINT");
    } catch { /* already gone */ }
  });

  return new Promise((resolve) => {
    let output = "";
    let echo = false;
    // Silent while it comes up as usual. Taking longer, Tailscale is most likely
    // waiting on something only a person can do — turning Serve on for the
    // tailnet — and is left to say so in its own words.
    const slow = setTimeout(() => {
      echo = true;
      process.stderr.write(`\x1b[2m${output}\x1b[0m`);
    }, 5000);

    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000);
      if (echo) process.stderr.write(`\x1b[2m${chunk}\x1b[0m`);
      if (output.includes(`https://${host}`)) {
        clearTimeout(slow);
        resolve();
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.on("error", (err) => fail(`could not run tailscale: ${err.message}`));
    child.on("exit", (code) => {
      if (stopping) return;
      fail(`tailscale serve stopped${code === null ? "" : ` (exit code ${code})`}\n${output.trim()}`);
    });
  });
}

/**
 * This machine's IPv4 addresses on the local network: not loopback, not
 * link-local, and not Tailscale's own 100.64.0.0/10, which --lan does not mean.
 */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((net) => net.family === "IPv4" && !net.internal)
    .map((net) => net.address)
    .filter((ip) => {
      const [a = 0, b = 0] = ip.split(".").map(Number);
      return !(a === 169 && b === 254) && !(a === 100 && b >= 64 && b < 128);
    });
}

const host = tailscale ? await tailnetHost() : null;
const token = lan ? randomBytes(12).toString("base64url") : null;
const site = createSite({ root, token, cmd: CMD });

try {
  Bun.serve({
    // Loopback unless --lan: `tailscale serve` reaches it from this machine as well.
    hostname: lan ? "0.0.0.0" : "127.0.0.1",
    port,
    fetch: (req, server) => site(req, server.requestIP(req)?.address),
  });
} catch (err) {
  if ((err as { code?: string }).code === "EADDRINUSE") fail(`port ${port} is already in use — pick another with --port`);
  throw err;
}

// Leaving through process.exit runs the "exit" listeners, which is where the
// tailscale child is taken down: Ctrl+C reaches this process, not its group.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0));

if (host) await serveOnTailnet(port, host);

const addresses: [string, string][] = [["this machine", `http://127.0.0.1:${port}`]];
if (host) addresses.push(["tailnet", `https://${host}`]);
if (lan) {
  const ips = lanAddresses();
  if (ips.length === 0) console.error(`\x1b[33mwarning:\x1b[0m found no local network address for --lan`);
  for (const ip of ips) addresses.push(["local network", `http://${ip}:${port}/?t=${token}`]);
}

const vaults = await listVaults(root);
const incomplete = vaults.filter((vault) => vault.state === "incomplete").length;
console.log(
  `\n\x1b[32mserving ${vaults.length} vault${vaults.length === 1 ? "" : "s"}\x1b[0m from \x1b[1m${displayPath(root)}\x1b[0m` +
  (incomplete ? ` \x1b[2m(${incomplete} incomplete)\x1b[0m` : ""),
);
for (const [label, url] of addresses) console.log(`  ${label.padEnd(14)} \x1b[36m${url}\x1b[0m`);

// The address a phone would type worst — the tailnet's, or the one carrying the
// token — as a code to scan instead.
const phone = addresses.find(([label]) => label !== "this machine")?.[1];
if (phone && has("qrencode")) {
  try {
    console.log(`\n${await run("qrencode", ["-t", "ansiutf8", phone])}`);
  } catch { /* the address above still works */ }
}

console.log(host || lan
  ? `\x1b[2mCtrl+C stops it\x1b[0m\n`
  : `\n\x1b[2mfrom your phone: --tailscale, or --lan on the same network · Ctrl+C stops it\x1b[0m\n`);
