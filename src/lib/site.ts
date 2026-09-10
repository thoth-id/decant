/**
 * The site `serve` puts up: the list of vaults, and each vault's documents
 * rendered on request. Nothing lands on disk, so an edited NOTES.md shows up on
 * the next reload and never trips over the NOTES.html that `view` writes.
 */

import { timingSafeEqual } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { BASE_CSS, FONTS, documentTitle, esc, renderPage, type PageNav } from "./page.ts";
import { stamp } from "./time.ts";
import { readMeta, type VaultMeta } from "./vault.ts";

/** How far along a vault is, which decides what the list can open. */
export type VaultState = "notes" | "brief" | "incomplete";

export interface VaultEntry {
  slug: string;
  state: VaultState;
  title: string;
  meta: VaultMeta | null;
  /** The card's thumbnail, relative to the vault. */
  cover: string | null;
  /** When the vault was generated, in ms: orders the list and flags what is new. */
  generatedAt: number;
}

/**
 * The first capture the notes embed. The analysis picked it for what it shows,
 * which the video's first frame — an opening title, a face — rarely earns.
 */
const COVER_RE = /!\[[^\]]*\]\((frames\/[^)\s]+)/;

/** Every vault in the directory, newest first. */
export async function listVaults(root: string): Promise<VaultEntry[]> {
  // Hidden directories are not vaults: `.staging` is a run still downloading.
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  const vaults = await Promise.all(dirs.map((entry) => readVault(join(root, entry.name), entry.name)));
  return vaults.sort((a, b) => b.generatedAt - a.generatedAt);
}

async function readVault(dir: string, slug: string): Promise<VaultEntry> {
  const [notes, hasBrief, meta, info] = await Promise.all([
    readFile(join(dir, "NOTES.md"), "utf8").catch(() => null),
    Bun.file(join(dir, "BRIEF.md")).exists(),
    readMeta(dir),
    stat(dir),
  ]);
  return {
    slug,
    state: notes !== null ? "notes" : hasBrief ? "brief" : "incomplete",
    title: (notes !== null && documentTitle(notes)) || meta?.title || slug,
    meta,
    cover: notes?.match(COVER_RE)?.[1] ?? meta?.frames?.[0]?.file ?? null,
    // A run cut short before meta.json has no date of its own; the directory's stands in.
    generatedAt: Date.parse(meta?.generatedAt ?? "") || info.mtimeMs,
  };
}

/**
 * A vault's documents as tabs, in reading order. The brief only gets one while
 * there are no notes: beside them it is processing detail, still reachable by
 * its address.
 */
const DOCS = [
  { file: "NOTES.md", label: "Notas" },
  { file: "BRIEF.md", label: "Brief" },
  { file: "RESOURCES.md", label: "Recursos" },
  { file: "CREDITS.md", label: "Creditos" },
] as const;

async function tabsOf(dir: string) {
  const present = await Promise.all(DOCS.map((doc) => Bun.file(join(dir, doc.file)).exists()));
  const docs = DOCS.filter((_, i) => present[i]);
  return docs[0]?.file === "NOTES.md" ? docs.filter((doc) => doc.file !== "BRIEF.md") : docs;
}

export interface SiteOptions {
  /** The vaults directory. */
  root: string;
  /**
   * Required of every request from another machine, or null when only this one
   * can connect. `tailscale serve` connects from loopback: the tailnet already
   * vouched for whoever is on the other end.
   */
  token: string | null;
  /** How to spell decant back to the reader, on a vault waiting for its notes. */
  cmd: string;
}

const COOKIE = "decant_token";
const COOKIE_RE = /(?:^|;\s*)decant_token=([^;]+)/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const IMAGE_RE = /\.(?:jpe?g|png|gif|webp)$/i;
/** A path segment taken literally: no separator, and nothing hidden or relative — `..`, `.work`. */
const SEGMENT_RE = /^[^./\\][^/\\]*$/;

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // Rebuilt from the markdown on every request: never keep a stale copy.
  "Cache-Control": "no-cache",
  // Following a timestamp to YouTube should not hand it the tailnet name or the path.
  "Referrer-Policy": "no-referrer",
};

const html = (body: string) => new Response(body, { headers: HTML_HEADERS });
const text = (status: number, body: string) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const redirect = (location: string) => new Response(null, { status: 308, headers: { Location: location } });
const notFound = () => text(404, "Nada aqui.");

/** Compares without letting the response time say how much of a guess was right. */
function sameToken(given: string, token: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The site's request handler, told which address each request came from. */
export function createSite({ root, token, cmd }: SiteOptions) {
  async function route(req: Request, pathname: string): Promise<Response> {
    if (pathname === "/") return html(renderIndex(await listVaults(root), cmd));

    let parts: string[];
    try {
      parts = pathname.slice(1).split("/").map((part) => decodeURIComponent(part));
    } catch {
      return notFound(); // malformed percent-encoding
    }
    // Every segment must be a plain name, except the empty one a trailing slash leaves.
    const plain = parts.every((part, i) => SEGMENT_RE.test(part) || (part === "" && i > 0 && i === parts.length - 1));
    const [slug, ...rest] = parts;
    if (!plain || !slug) return notFound();

    const dir = join(root, slug);
    if (!(await stat(dir).catch(() => null))?.isDirectory()) return notFound();

    const base = `/${encodeURIComponent(slug)}/`;
    // The documents link to frames/ and ./CREDITS.md relatively: without the
    // trailing slash those would resolve one level up, outside the vault.
    if (rest.length === 0) return redirect(base);

    const [first, second] = rest;
    if (rest.length === 2 && first === "frames" && second && IMAGE_RE.test(second)) {
      return frame(req, join(dir, "frames", second));
    }
    if (rest.length !== 1 || first === undefined) return notFound();

    const tabs = await tabsOf(dir);
    const lead = tabs[0]?.file;
    const main = lead === "NOTES.md" || lead === "BRIEF.md" ? lead : null;
    // The main document has a single address: the vault's own.
    if (first === main) return redirect(base);

    const file = first === "" ? main : first;
    if (!file || !file.toLowerCase().endsWith(".md") || !(await Bun.file(join(dir, file)).exists())) {
      return notFound();
    }

    const nav: PageNav = {
      home: "/",
      tabs: tabs.map((doc) => ({
        label: doc.label,
        href: doc.file === main ? base : base + encodeURIComponent(doc.file),
        current: doc.file === file,
      })),
    };
    return html(await renderPage({ vaultDir: dir, file, standalone: false, nav }));
  }

  return async (req: Request, remote: string | undefined): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD") return text(405, "Metodo nao suportado.");
    const url = new URL(req.url);

    if (token && !LOOPBACK.has(remote ?? "")) {
      const given = url.searchParams.get("t");
      if (given !== null && sameToken(given, token)) {
        // The token in the address becomes a cookie, so the address bar — and
        // every link on the pages — goes without it from here on.
        return new Response(null, {
          status: 303,
          headers: {
            Location: url.pathname,
            "Set-Cookie": `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
          },
        });
      }
      const cookie = req.headers.get("cookie")?.match(COOKIE_RE)?.[1];
      if (!cookie || !sameToken(cookie, token)) {
        return text(401, "Abra o endereco completo, com o token, que o decant mostrou no terminal.");
      }
    }

    try {
      return await route(req, url.pathname);
    } catch (err) {
      console.error(`\x1b[31merror:\x1b[0m ${url.pathname}: ${(err as Error).message}`);
      return text(500, "A pagina falhou ao ser montada; o erro esta no terminal.");
    }
  };
}

/**
 * A capture, revalidated by size and date: a vault reprocessed with --force can
 * reuse a file name for a different image, and a phone on mobile data should
 * not download the unchanged ones again.
 */
async function frame(req: Request, path: string): Promise<Response> {
  const file = Bun.file(path);
  if (!(await file.exists())) return notFound();
  const etag = `"${file.size.toString(36)}-${Math.floor(file.lastModified).toString(36)}"`;
  const headers = { ETag: etag, "Cache-Control": "no-cache" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(file, { headers });
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "10 set" — with the year only when it is not the current one. */
function shortDate(ms: number): string {
  const date = new Date(ms);
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return date.getFullYear() === new Date().getFullYear() ? day : `${day} ${date.getFullYear()}`;
}

/** Lowercase, accents stripped: the filter finds "Índices" from "indices". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function card(vault: VaultEntry, cmd: string): string {
  const href = `/${encodeURIComponent(vault.slug)}/`;
  const { meta } = vault;
  const by = meta?.uploader ?? (meta && !meta.url ? "arquivo local" : "");
  const facts = [meta?.durationSeconds ? stamp(meta.durationSeconds) : "", shortDate(vault.generatedAt)]
    .filter(Boolean)
    .join(" · ");
  const search = fold(`${vault.title} ${by} ${vault.slug}`);

  return `<li data-slug="${esc(vault.slug)}" data-generated="${vault.generatedAt}" data-search="${esc(search)}">
<a href="${href}">
  <div class="thumb">${vault.cover ? `<img src="${href}${esc(vault.cover)}" alt="" loading="lazy">` : ""}</div>
  <div class="card">
    <h2>${esc(vault.title)}</h2>
    ${by ? `<p class="by">${esc(by)}</p>` : ""}
    <p class="facts"><span>${facts}</span><span class="tag new" hidden>novo</span></p>
    ${vault.state === "brief" ? `<p class="hint"><span class="tag wait">aguardando analise</span> ${esc(cmd)} analyze ${esc(vault.slug)} --claude</p>` : ""}
  </div>
</a>
</li>`;
}

/** The list of vaults: what `serve` answers at its root. */
export function renderIndex(vaults: VaultEntry[], cmd: string): string {
  const ready = vaults.filter((vault) => vault.state !== "incomplete");
  const incomplete = vaults.filter((vault) => vault.state === "incomplete");
  const notes = ready.filter((vault) => vault.state === "notes").length;
  const waiting = ready.length - notes;

  const summary = vaults.length === 0 ? "Nenhum vault ainda" : [
    notes && `${notes} com notas`,
    waiting && `${waiting} aguardando analise`,
    incomplete.length && `${incomplete.length} ${incomplete.length === 1 ? "incompleto" : "incompletos"}`,
  ].filter(Boolean).join(" · ");

  const list = ready.length === 0
    ? `<p class="none">Nenhum vault pronto para ler. Gere um com <code>${esc(cmd)} &lt;url-ou-arquivo&gt;</code>.</p>`
    : `${ready.length > 1 ? `<input class="filter" type="search" placeholder="Filtrar por titulo ou canal" aria-label="Filtrar vaults" autocomplete="off">` : ""}
<ul class="vaults">
${ready.map((vault) => card(vault, cmd)).join("\n")}
</ul>
<p class="none" hidden>Nenhum vault com esse nome.</p>`;

  const stalled = incomplete.length === 0 ? "" : `<section class="incomplete">
<h2>Incompletos</h2>
<ul>
${incomplete.map((vault) => `<li><code>${esc(vault.slug)}</code>sem notas nem brief: o processamento parou no meio ou ainda esta rodando</li>`).join("\n")}
</ul>
</section>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="apple-mobile-web-app-title" content="decant">
<title>Vaults · decant</title>
${FONTS}
<style>${BASE_CSS}${INDEX_CSS}</style>
</head>
<body>
<header class="masthead wrap">
  <p class="kicker">decant</p>
  <h1>Vaults</h1>
  <p class="source">${summary}</p>
</header>
<main class="wrap">
${list}
${stalled}
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

const INDEX_CSS = `
[hidden]{display:none!important}
main{padding-block:0 64px}
.filter{display:block;width:100%;margin:0 0 16px;padding:12px 14px;border:1px solid var(--rule);border-radius:3px;
        background:var(--surface);color:var(--ink);font:500 16px/1.3 var(--mono)}
.filter::placeholder{color:var(--muted)}
.vaults{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--rule);
        border-radius:4px;box-shadow:var(--shadow);overflow:hidden}
.vaults li+li{border-top:1px solid var(--rule-soft)}
.vaults a{display:flex;gap:18px;align-items:flex-start;padding:18px 20px;color:inherit;text-decoration:none}
.vaults a:hover{background:var(--surface-alt)}
.thumb{flex:0 0 132px;aspect-ratio:16/9;overflow:hidden;border:1px solid var(--rule-soft);border-radius:2px;
       background:var(--surface-alt)}
.thumb img{display:block;width:100%;height:100%;object-fit:cover}
.card{flex:1;min-width:0}
.card h2{margin:0 0 4px;font-family:var(--display);font-weight:600;font-size:1.12rem;line-height:1.22;
         letter-spacing:-.01em;text-wrap:pretty}
.card p{margin:0}
.card .by{color:var(--ink-soft);font-size:.92rem;line-height:1.4}
.card .facts{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:6px;
             font-family:var(--mono);font-size:12px;color:var(--muted)}
.card .hint{margin-top:8px;font-family:var(--mono);font-size:11.5px;line-height:1.55;color:var(--muted);
            overflow-wrap:anywhere}
.tag{display:inline-block;padding:1px 6px;border-radius:2px;font-family:var(--mono);font-size:10.5px;
     font-weight:500;letter-spacing:.1em;text-transform:uppercase;line-height:1.5}
.tag.new{background:var(--amber);color:var(--surface)}
.tag.wait{border:1px solid currentColor;color:var(--amber)}
.none{color:var(--muted)}
.none code{font-family:var(--mono);font-size:.85em}
.incomplete{margin-top:40px}
.incomplete h2{margin:0 0 6px;font-family:var(--mono);font-size:11px;font-weight:500;letter-spacing:.14em;
               text-transform:uppercase;color:var(--muted)}
.incomplete ul{list-style:none;margin:0;padding:0}
.incomplete li{padding:10px 0;border-top:1px solid var(--rule-soft);color:var(--muted);font-size:.9rem;line-height:1.45}
.incomplete code{display:block;font-family:var(--mono);font-size:.8rem;color:var(--ink-soft);overflow-wrap:anywhere}
@media (max-width:560px){
  .wrap{padding-inline:16px}
  .masthead{padding-block:36px 22px}
  .vaults a{gap:14px;padding:14px}
  .thumb{flex-basis:96px}
}
`;

const SCRIPT = String.raw`
(() => {
  // "Novo" is per device: generated after this browser first saw the list, and
  // not opened here since.
  const KEY = "decant:seen";
  const cards = [...document.querySelectorAll(".vaults li")];
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!seen || typeof seen.since !== "number" || !Array.isArray(seen.opened)) seen = { since: Date.now(), opened: [] };
  const slugs = cards.map((li) => li.dataset.slug);
  seen.opened = seen.opened.filter((slug) => slugs.includes(slug));
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch {} };
  save();

  for (const li of cards) {
    const tag = li.querySelector(".new");
    tag.hidden = !(Number(li.dataset.generated) > seen.since) || seen.opened.includes(li.dataset.slug);
    li.querySelector("a").addEventListener("click", () => {
      tag.hidden = true;
      if (!seen.opened.includes(li.dataset.slug)) seen.opened.push(li.dataset.slug);
      save();
    });
  }

  const filter = document.querySelector(".filter");
  const list = document.querySelector(".vaults");
  const none = document.querySelector(".none");
  const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  filter?.addEventListener("input", () => {
    const words = fold(filter.value).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const li of cards) {
      li.hidden = !words.every((word) => li.dataset.search.includes(word));
      if (!li.hidden) shown++;
    }
    list.hidden = shown === 0;
    none.hidden = shown > 0;
  });
})();
`;
