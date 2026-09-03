/**
 * Credits for the original work.
 *
 * A vault's content is derived from someone else's work, so whoever produced it
 * has to show up alongside. The sources, from most to least reliable: platform
 * metadata, links in the description, and whatever the agent picks up from the
 * audio and the screens during analysis.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classify, isMaterial, renderResourcesMd, type Chapter, type ClassifiedLink } from "./resources.ts";

export type CreditLink = ClassifiedLink;

export interface Credits {
  title: string;
  author?: string;
  authorUrl?: string;
  /** Publication date in ISO form (YYYY-MM-DD). */
  publishedAt?: string;
  license?: string;
  sourceUrl?: string;
  /** Opening of the description, where declared authorship usually lives. */
  summary?: string;
  links: CreditLink[];
}

/** yt-dlp returns the date as YYYYMMDD. */
function isoDate(raw?: string): string | undefined {
  if (!raw || !/^\d{8}$/.test(raw)) return undefined;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** "Standard YouTube License" adds nothing; only an explicit license matters. */
function cleanLicense(raw?: string): string | undefined {
  if (!raw) return undefined;
  const v = raw.trim();
  return /standard youtube/i.test(v) ? undefined : v;
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** Enough links to credit the work without turning the list into the whole description. */
const MAX_LINKS = 12;

/** Drops the decoration a description puts in front of a label: bullets, emoji, arrows. */
const trimLabel = (raw: string) => raw.replace(/^[^\p{L}\p{N}]+/u, "").trim();

/**
 * Extracts links from the description, preserving the label that introduces
 * them. Common shapes: "Site: http://…", "HOSTNET: http://…", or a section
 * heading ("Patrocinio") followed by its links.
 */
export function linksFromDescription(description: string): CreditLink[] {
  const out: CreditLink[] = [];
  const seen = new Set<string>();
  let section = "";

  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const urls = line.match(URL_RE);
    if (!urls) {
      // A short line with no link is usually the heading of the next section.
      if (line.length <= 40 && !line.endsWith(".")) {
        section = trimLabel(line.replace(/[:—-]\s*$/, ""));
      }
      continue;
    }

    // "Label: url" at the start of the line wins over the section and the domain.
    // It depends on the line alone, so it is read once for all its links.
    const lineLabel = trimLabel(line.match(/^([^:]{2,40}):\s*https?:\/\//)?.[1] ?? "");

    for (const url of urls) {
      const clean = url.replace(/[.,;]+$/, "");
      if (seen.has(clean)) continue;
      seen.add(clean);

      let label = lineLabel;
      if (!label) {
        try { label = trimLabel(new URL(clean).hostname.replace(/^www\./, "")) || "link"; }
        catch { label = "link"; }
      }
      const sameAsSection = section.toLowerCase() === label.toLowerCase();
      const finalLabel = section && !sameAsSection ? `${section} — ${label}` : label;
      out.push({ label: finalLabel, url: clean, kind: classify(finalLabel, clean) });
      if (out.length >= MAX_LINKS) return out;
    }
  }
  return out;
}

/** Source data sufficient to credit the work. */
export interface AttributionSource {
  title: string;
  uploader?: string;
  uploaderUrl?: string;
  uploadDate?: string;
  license?: string;
  url?: string;
  description?: string;
  chapters?: Chapter[];
}

/** First line of the description that stands on its own as a summary of the work. */
function firstProseLine(description: string): string | undefined {
  for (const raw of description.split(/\r?\n/)) {
    const line = raw.replace(URL_RE, "").replace(/\s{2,}/g, " ").trim().replace(/[\s:;,-]+$/, "");
    if (line.length > 40) return line;
  }
  return undefined;
}

/** Assembles the credits from what the platform reported. */
export function buildCredits(info: AttributionSource): Credits {
  const description = info.description ?? "";
  const summary = firstProseLine(description);

  return {
    title: info.title,
    author: info.uploader,
    authorUrl: info.uploaderUrl,
    publishedAt: isoDate(info.uploadDate),
    license: cleanLicense(info.license),
    sourceUrl: info.url,
    summary,
    links: description ? linksFromDescription(description) : [],
  };
}

/** The vault's credits document. */
export function renderCreditsMd(c: Credits): string {
  const lines: string[] = [
    `# Creditos`,
    ``,
    `O conteudo original desta aula pertence a quem a produziu. Este vault`,
    `guarda apenas anotacoes de estudo derivadas dela.`,
    ``,
    `## Obra`,
    ``,
    `- **Titulo:** ${c.title}`,
  ];

  if (c.author) lines.push(`- **Autoria / canal:** ${c.authorUrl ? `[${c.author}](${c.authorUrl})` : c.author}`);
  if (c.publishedAt) lines.push(`- **Publicado em:** ${c.publishedAt}`);
  if (c.license) lines.push(`- **Licenca declarada:** ${c.license}`);
  if (c.sourceUrl) lines.push(`- **Assista no original:** ${c.sourceUrl}`);
  if (!c.sourceUrl) lines.push(`- **Origem:** arquivo local (sem metadados de plataforma)`);

  if (c.summary) {
    lines.push(``, `## Como a obra se descreve`, ``, `> ${c.summary}`);
  }

  const attribution = c.links.filter((l) => !isMaterial(l.kind));
  if (attribution.length) {
    lines.push(``, `## Canais e apoio`, ``);
    for (const l of attribution) lines.push(`- ${l.label}: ${l.url}`);
  }
  if (c.links.some((l) => isMaterial(l.kind))) {
    lines.push(``, `Links de estudo citados pela obra estao em [RESOURCES.md](./RESOURCES.md).`);
  }

  lines.push(
    ``,
    `## Creditos citados na aula`,
    ``,
    `<!-- Preenchido durante a analise: nomes ditos na fala ou exibidos na tela`,
    `     (professor, co-autores, fontes citadas, ferramentas creditadas). -->`,
    ``,
    `---`,
    ``,
    `_Se for redistribuir qualquer parte destas anotacoes, mantenha esta pagina_`,
    `_junto e prefira apontar para a obra original._`,
    ``,
  );

  return lines.join("\n");
}

/**
 * Writes the vault's pair of attribution documents. The single path to produce
 * CREDITS.md and RESOURCES.md, whether during video processing or on a later
 * re-query of the platform.
 *
 * It takes the finished `Credits` rather than a source to derive them from, so
 * a caller that already holds them — `credits --offline`, reading meta.json —
 * does not have to flatten them back into platform fields to get here.
 */
export async function writeAttribution(
  vaultDir: string,
  credits: Credits,
  chapters: Chapter[],
): Promise<void> {
  await Promise.all([
    writeFile(join(vaultDir, "CREDITS.md"), renderCreditsMd(credits)),
    writeFile(join(vaultDir, "RESOURCES.md"), renderResourcesMd({
      title: credits.title,
      sourceUrl: credits.sourceUrl,
      links: credits.links,
      chapters,
    })),
  ]);
}
