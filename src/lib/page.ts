import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { marked } from "marked";
import { stamp } from "./time.ts";
import { readMeta } from "./vault.ts";

/** Extension -> mime, used to embed images as data URIs in standalone mode. */
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp",
};

/** The dark palette, shared by the media query and the explicit theme override. */
const DARK_TOKENS = String.raw`
  --ground:#0c141b; --surface:#131e27; --surface-alt:#1b2833;
  --ink:#e7eef4; --ink-soft:#bccbd7; --muted:#8296a6;
  --rule:#2b3b47; --rule-soft:#21303b;
  --amber:#e8a33d; --teal:#4cbdbd;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px rgba(0,0,0,.35);
`;

const CSS = `
:root {
  --ground:#eef1f4; --surface:#fff; --surface-alt:#e4e9ee;
  --ink:#101c26; --ink-soft:#3d4f5e; --muted:#66798a;
  --rule:#cbd5dd; --rule-soft:#dde3e9;
  --amber:#a05a06; --teal:#0a6f70;
  --shadow:0 1px 2px rgba(16,28,38,.06),0 8px 24px rgba(16,28,38,.06);
  --display:"Bricolage Grotesque",ui-sans-serif,system-ui,sans-serif;
  --body:"Source Serif 4",Georgia,serif;
  --mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK_TOKENS}}}
:root[data-theme="dark"]{${DARK_TOKENS}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);
     font-size:18px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:var(--teal);text-underline-offset:2px}
:focus-visible{outline:2px solid var(--amber);outline-offset:3px}

.wrap{max-width:1080px;margin-inline:auto;padding-inline:28px}
.masthead{padding-block:52px 30px}
.kicker{font-family:var(--mono);font-size:11.5px;font-weight:500;letter-spacing:.16em;
        text-transform:uppercase;color:var(--amber);margin:0 0 16px}
.masthead h1{font-family:var(--display);font-weight:800;font-size:clamp(2rem,5.2vw,3.2rem);
  line-height:1.04;letter-spacing:-.024em;text-wrap:balance;margin:0 0 14px}
.source{margin:0;color:var(--ink-soft);font-size:1.05rem;max-width:62ch}

.readout{display:flex;flex-wrap:wrap;gap:2px;margin-top:30px;border:1px solid var(--rule);
         border-radius:3px;overflow:hidden;background:var(--rule)}
.readout div{flex:1 1 120px;background:var(--surface);padding:14px 18px}
.readout dt{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;
            color:var(--muted);margin-bottom:5px}
.readout dd{margin:0;font-family:var(--display);font-weight:600;font-size:1.4rem;
            font-variant-numeric:tabular-nums;letter-spacing:-.01em}

.paper{background:var(--surface);border:1px solid var(--rule);border-radius:4px;
       box-shadow:var(--shadow);padding:44px 0 40px;margin:12px auto 0;max-width:1080px}
.doc{max-width:760px;margin-inline:auto;padding-inline:clamp(22px,5vw,54px)}
.filetag{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);border-bottom:1px solid var(--rule-soft);padding-bottom:14px;margin-bottom:30px;
  display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}

.doc h1{font-family:var(--display);font-weight:700;font-size:1.85rem;line-height:1.14;
        letter-spacing:-.018em;text-wrap:balance;margin:0 0 16px}
.doc h2{font-family:var(--display);font-weight:700;font-size:1.42rem;letter-spacing:-.014em;
        line-height:1.18;text-wrap:balance;margin:38px 0 12px}
.doc h3{font-family:var(--display);font-weight:600;font-size:1.1rem;margin:26px 0 10px}
.doc p{margin:0 0 15px}
.doc ul,.doc ol{margin:0 0 16px;padding-left:1.3em}
.doc li{margin-bottom:9px}
.doc li::marker{color:var(--muted)}
.doc strong{font-weight:600}
.doc em{color:var(--ink-soft)}
.doc hr{border:0;border-top:1px solid var(--rule-soft);margin:32px 0}
.doc blockquote{margin:20px 0;padding:2px 0 2px 18px;border-left:2px solid var(--amber);
                color:var(--ink-soft);font-size:.96rem}
.doc blockquote p:last-child{margin-bottom:0}
.doc img{display:block;width:100%;border:1px solid var(--rule);border-radius:2px;margin:22px 0 8px}
.doc table{width:100%;border-collapse:collapse;margin:0 0 20px;font-size:.93rem;display:block;overflow-x:auto}
.doc th{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
        color:var(--muted);text-align:left;font-weight:500;border-bottom:1px solid var(--rule);padding:8px 14px 8px 0}
.doc td{padding:9px 14px 9px 0;border-bottom:1px solid var(--rule-soft)}
.doc pre{font-family:var(--mono);font-size:.78rem;line-height:1.62;background:var(--surface-alt);
  border:1px solid var(--rule-soft);border-left:2px solid var(--teal);border-radius:2px;
  padding:14px 16px;margin:0 0 18px;overflow-x:auto}
.doc code{font-family:var(--mono);font-size:.82em;background:var(--surface-alt);border-radius:2px;padding:.1em .34em}
.doc pre code{background:none;padding:0;font-size:inherit}
/* timestamps [mm:ss] linking back to the source */
.doc a[href*="youtu"],.doc a[href*="vimeo"]{font-family:var(--mono);font-size:.74em;font-weight:500;
  color:var(--amber);white-space:nowrap;text-decoration:none;border-bottom:1px dotted currentColor}
.doc a[href*="youtu"]:hover,.doc a[href*="vimeo"]:hover{border-bottom-style:solid}

footer{padding:28px 28px 56px;max-width:1080px;margin-inline:auto;color:var(--muted);font-size:.88rem}
footer p{margin:0 0 6px}
footer .attrib{color:var(--ink-soft);border-left:2px solid var(--amber);padding-left:12px}
footer a{color:var(--teal)}
@media print{
  body{background:#fff}
  .paper{box-shadow:none;border:0;padding-top:0}
  .masthead{padding-block:0 18px}
  .readout{display:none}
  footer{color:#333;border-top:1px solid #ccc;padding-top:12px}
}
`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const IMG_SRC_RE = /src="([^"]+\.(?:jpe?g|png|gif|webp))"/gi;

/**
 * Swaps local images for data URIs so the HTML can be moved or sent on its own.
 * The reads happen together and the replacement is a single pass: a vault with
 * dozens of frames produces a string several MB long, and rebuilding it once
 * per image would cost quadratic time.
 */
async function inlineImages(html: string, vaultDir: string): Promise<string> {
  const sources = new Set(
    [...html.matchAll(IMG_SRC_RE)]
      .map((m) => m[1]!)
      .filter((src) => !src.startsWith("data:") && !/^https?:/.test(src)),
  );
  if (sources.size === 0) return html;

  const inlined = new Map<string, string>();
  await Promise.all([...sources].map(async (src) => {
    try {
      const buf = await readFile(join(vaultDir, src));
      const ext = src.slice(src.lastIndexOf(".")).toLowerCase();
      inlined.set(src, `data:${MIME[ext] ?? "image/jpeg"};base64,${buf.toString("base64")}`);
    } catch { /* a missing image is left as is */ }
  }));

  return html.replace(IMG_SRC_RE, (whole, src: string) => {
    const uri = inlined.get(src);
    return uri ? `src="${uri}"` : whole;
  });
}

export interface PageInput {
  vaultDir: string;
  /** Name of the markdown file inside the vault. */
  file: string;
  /** Embeds the images as base64, producing a self-contained HTML file. */
  standalone: boolean;
}

/** Turns a markdown file from the vault into a complete HTML page. */
export async function renderPage({ vaultDir, file, standalone }: PageInput): Promise<string> {
  const [md, meta] = await Promise.all([
    readFile(join(vaultDir, file), "utf8"),
    readMeta(vaultDir),
  ]);

  // The first <h1> becomes the page header, not part of the document body.
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim() ?? meta?.title ?? basename(vaultDir);
  const body = await marked.parse(titleMatch ? md.replace(titleMatch[0], "") : md);

  const html = standalone ? await inlineImages(body, vaultDir) : body;

  const stats = [
    meta?.durationSeconds && `<div><dt>Duracao</dt><dd>${stamp(meta.durationSeconds)}</dd></div>`,
    meta?.wordCount && `<div><dt>Palavras ouvidas</dt><dd>${meta.wordCount.toLocaleString("pt-BR")}</dd></div>`,
    meta?.frameCount && `<div><dt>Telas</dt><dd>${meta.frameCount}</dd></div>`,
    meta?.segmentCount && `<div><dt>Segmentos</dt><dd>${meta.segmentCount}</dd></div>`,
  ].filter(Boolean).join("");

  const source = meta?.url
    ? `<a href="${esc(meta.url)}">${esc(meta.uploader ?? "ver original")}</a>`
    : "arquivo local";

  // Attribution for the original work: it travels with the page wherever it goes.
  const c = meta?.credits;
  const attrib: string[] = [];
  if (c?.author) {
    attrib.push(`Conteudo original de ${c.authorUrl ? `<a href="${esc(c.authorUrl)}">${esc(c.author)}</a>` : esc(c.author)}`);
  }
  if (c?.publishedAt) attrib.push(`publicado em ${esc(c.publishedAt)}`);
  if (c?.license) attrib.push(`licenca: ${esc(c.license)}`);
  const attribLine = attrib.length ? attrib.join(" · ") : "Confira CREDITS.md para a autoria da obra original.";
  const original = c?.sourceUrl ? `<a href="${esc(c.sourceUrl)}">assista ao original</a>` : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
</head>
<body>
<header class="masthead wrap">
  <p class="kicker">decant</p>
  <h1>${esc(title)}</h1>
  <p class="source">Fonte: ${source}</p>
  ${stats ? `<dl class="readout">${stats}</dl>` : ""}
</header>
<article class="paper">
  <div class="doc">
    <div class="filetag"><span>${esc(basename(vaultDir))}/${esc(file)}</span><span>${standalone ? "arquivo unico" : "imagens em frames/"}</span></div>
    ${html}
  </div>
</article>
<footer>
  <p class="attrib">${attribLine}${original ? ` · ${original}` : ""}</p>
  <p>Anotacoes de estudo derivadas da obra acima, geradas por decant.</p>
</footer>
</body>
</html>`;
}
