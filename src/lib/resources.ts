/**
 * Supporting materials and classification of the links found in the description.
 *
 * Not every link plays the same role: the channel's Facebook page is a credit,
 * the exercises repository is study material. Telling them apart keeps the
 * materials section from turning into a list of social networks.
 */

import { deepLink, stamp } from "./time.ts";

export type LinkKind =
  | "code" | "download" | "documentation" | "course"
  | "community" | "social" | "sponsor" | "other";

export interface ClassifiedLink {
  /** Label read from the description ("Site", "Patrocinio — HOSTNET") or the domain. */
  label: string;
  url: string;
  kind: LinkKind;
}

/** Chapter declared by the platform. */
export interface Chapter {
  start: number;
  title: string;
}

// The label patterns match Brazilian Portuguese descriptions, which is what the
// sources this tool targets are written in.
const RULES: { kind: LinkKind; host?: RegExp; path?: RegExp; label?: RegExp }[] = [
  { kind: "sponsor", label: /patroc|sponsor|apoi[oa]|parceir|oferecim|assinante|assine|seja membro|apoie/i },
  { kind: "social", host: /(^|\.)(facebook|instagram|twitter|x|tiktok|linkedin|threads|bsky|plus\.google)\./i },
  { kind: "social", host: /(^|\.)youtube\.com$/i, path: /^\/(@|c\/|user\/|channel\/|cursosemvideo)/i },
  { kind: "code", host: /(^|\.)(github|gitlab|bitbucket|codeberg|codepen|replit|codesandbox|stackblitz)\./i },
  { kind: "download", host: /(^|\.)(drive\.google|dropbox|mega|mediafire|1drv|wetransfer)\./i },
  { kind: "download", path: /\.(pdf|zip|rar|7z|tar\.gz|docx?|pptx?|xlsx?)$|\/download/i },
  { kind: "documentation", host: /(^|\.)(docs?|developer|devdocs|readthedocs|mdn)\./i },
  { kind: "documentation", path: /^\/docs?(\/|$)|\/documentation/i },
  { kind: "documentation", host: /(^|\.)(w3schools|developer\.mozilla)\./i },
  { kind: "community", host: /(^|\.)(discord|slack|t\.me|telegram|reddit|stackoverflow)\./i },
  { kind: "course", path: /\/(course|curso|aula|class|lesson|material|apostila|exercicio)/i },
  { kind: "course", host: /(^|\.)(udemy|coursera|alura|edx|khanacademy|rocketseat)\./i },
  { kind: "course", label: /curso|material|apostila|exerc|slide|download|codigo|código|reposit|livro|ebook|documenta/i },
];

/** Works out a link's role from its label, domain and path. */
export function classify(label: string, url: string): LinkKind {
  let host = "", path = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    path = u.pathname;
  } catch { /* a malformed URL falls through to "other" */ }

  for (const r of RULES) {
    // A label rule is decided by the label alone; the rest narrow host then path.
    if (r.label) {
      if (r.label.test(label)) return r.kind;
      continue;
    }
    if (r.host && !r.host.test(host)) continue;
    if (r.path && !r.path.test(path)) continue;
    return r.kind;
  }
  return "other";
}

/** Links that serve the study — the rest is credit or social media. */
export function isMaterial(kind: LinkKind): boolean {
  return kind !== "social" && kind !== "sponsor";
}

const ORDER = ["course", "code", "download", "documentation", "community", "other"] as const;

const KIND_LABEL: Record<(typeof ORDER)[number], string> = {
  course: "Curso e material de apoio",
  code: "Codigo e repositorios",
  download: "Downloads",
  documentation: "Documentacao",
  community: "Comunidade",
  other: "Outros links",
};

export interface ResourcesInput {
  title: string;
  sourceUrl?: string;
  links: ClassifiedLink[];
  chapters: Chapter[];
}

/** The vault's supporting-materials document. */
export function renderResourcesMd(r: ResourcesInput): string {
  const materials = r.links.filter((l) => isMaterial(l.kind));
  const lines: string[] = [
    `# Materiais complementares`,
    ``,
    `Recursos citados pela obra original. Creditos de autoria ficam em`,
    `[CREDITS.md](./CREDITS.md).`,
    ``,
  ];

  if (materials.length === 0) {
    lines.push(`## Da descricao`, ``, `Nenhum link de material foi encontrado na descricao.`, ``);
  } else {
    for (const kind of ORDER) {
      const group = materials.filter((l) => l.kind === kind);
      if (!group.length) continue;
      lines.push(`## ${KIND_LABEL[kind]}`, ``);
      for (const l of group) lines.push(`- [${l.label}](${l.url})`);
      lines.push(``);
    }
  }

  if (r.chapters.length) {
    lines.push(`## Capitulos do video`, ``);
    for (const c of r.chapters) {
      const href = deepLink(r.sourceUrl, c.start);
      lines.push(`- \`${stamp(c.start)}\` ${c.title}${href ? ` — [assistir](${href})` : ""}`);
    }
    lines.push(``);
  }

  lines.push(
    `## Citados na aula`,
    ``,
    `<!-- Preenchido durante a analise: links ditos na fala ("link na descricao",`,
    `     "baixe em..."), URLs exibidas na tela, livros, docs e ferramentas`,
    `     recomendadas. Nao invente endereco: registre o nome quando a URL nao`,
    `     estiver visivel. -->`,
    ``,
  );

  return lines.join("\n");
}
