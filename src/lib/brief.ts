import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Frame } from "./frames.ts";
import type { Segment } from "./transcribe.ts";
import type { SourceMeta } from "./ingest.ts";
import { buildCredits, writeAttribution } from "./credits.ts";
import { stamp, stampLink } from "./time.ts";
import { writeMeta } from "./vault.ts";

/** How much speech goes into one readable block of the transcript, in seconds. */
const BLOCK_SECONDS = 30;

/** Merges whisper's short segments into readable blocks of ~BLOCK_SECONDS. */
function groupSegments(segments: Segment[]): Segment[] {
  const blocks: Segment[] = [];
  for (const seg of segments) {
    const text = seg.text.replace(/\s+/g, " ");
    const last = blocks[blocks.length - 1];
    if (last && seg.end - last.start < BLOCK_SECONDS) {
      last.end = seg.end;
      last.text += ` ${text}`;
    } else {
      blocks.push({ ...seg, text });
    }
  }
  return blocks;
}

export interface BriefInput {
  vaultDir: string;
  /** Vault path as the user would type it — goes into the BRIEF instructions. */
  vaultRel: string;
  source: SourceMeta;
  segments: Segment[];
  frames: Frame[];
  /** Spoken language, detected or given. */
  language: string;
}

/** Writes transcript.md, frames.md, meta.json and BRIEF.md inside the vault. */
export async function writeBrief({ vaultDir, vaultRel, source, segments, frames, language }: BriefInput): Promise<void> {
  const blocks = groupSegments(segments);
  const words = segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);

  // --- transcript.md: raw material, consulted during the analysis -----------
  const transcript = [
    `# Transcricao — ${source.title}`,
    "",
    `> Material bruto gerado por whisper.cpp. Serve de insumo para a analise;`,
    `> nao e o documento final.`,
    "",
    ...blocks.map((b) => `### ${stampLink(source.url, b.start)}\n\n${b.text}\n`),
  ].join("\n");

  // --- frames.md: visual index with timestamps ------------------------------
  const frameIndex = [
    `# Frames capturados — ${source.title}`,
    "",
    `${frames.length} capturas selecionadas por troca de cena e filtradas por similaridade.`,
    "",
    ...frames.map((f, i) =>
      `### ${i + 1}. ${stampLink(source.url, f.time)}\n\n![frame em ${stamp(f.time)}](${f.rel})\n`),
  ].join("\n");

  // --- CREDITS.md and RESOURCES.md: authorship and materials of the original -
  const credits = buildCredits(source);
  const chapters = source.chapters ?? [];
  await writeAttribution(vaultDir, credits, chapters);

  // --- BRIEF.md: entrypoint of the analysis --------------------------------
  const brief = [
    `# BRIEF — ${source.title}`,
    "",
    "Pacote de analise pronto. **Este arquivo nao e o documento final.**",
    "",
    "| | |",
    "|---|---|",
    `| Duracao | ${stamp(source.duration)} |`,
    `| Palavras transcritas | ${words.toLocaleString("pt-BR")} |`,
    `| Segmentos transcritos | ${segments.length} |`,
    `| Blocos de fala | ${blocks.length} |`,
    `| Frames capturados | ${frames.length} |`,
    `| Idioma da fala | ${language} |`,
    source.uploader ? `| Autor | ${source.uploader} |` : null,
    credits.license ? `| Licenca | ${credits.license} |` : null,
    source.url ? `| Origem | ${source.url} |` : "| Origem | arquivo local |",
    "",
    "## Arquivos",
    "",
    "- `transcript.md` — fala completa com timestamps (insumo bruto)",
    "- `frames.md` — indice visual das capturas",
    "- `frames/` — imagens em JPG, nomeadas pelo instante",
    "- `meta.json` — dados estruturados",
    "- `CREDITS.md` — autoria da obra original (leia antes de publicar qualquer coisa)",
    "- `RESOURCES.md` — materiais complementares e capitulos",
    "- `NOTES.md` — **documento final de estudo** (escrito na etapa de analise)",
    "",
    "## Mapa de frames",
    "",
    "Instantes capturados, para cruzar com a transcricao:",
    "",
    ...frames.map((f, i) => `- \`${f.rel}\` — ${stamp(f.time)} (#${i + 1})`),
    "",
    ...(chapters.length ? [
      "## Capitulos declarados pela plataforma",
      "",
      "Estrutura que a propria obra define — util como esqueleto do documento:",
      "",
      ...chapters.map((c) => `- \`${stamp(c.start)}\` ${c.title}`),
      "",
    ] : []),
    "## Proximo passo",
    "",
    "Peca a analise no Claude Code:",
    "",
    "```",
    `analisa o vault ${vaultRel} e escreve o NOTES.md`,
    "```",
    "",
  ].filter((line) => line !== null).join("\n");

  await Promise.all([
    writeFile(join(vaultDir, "transcript.md"), transcript),
    writeFile(join(vaultDir, "frames.md"), frameIndex),
    writeFile(join(vaultDir, "BRIEF.md"), brief),
    writeMeta(vaultDir, {
      title: source.title,
      url: source.url ?? null,
      uploader: source.uploader ?? null,
      durationSeconds: Math.round(source.duration),
      wordCount: words,
      segmentCount: segments.length,
      language,
      frameCount: frames.length,
      frames: frames.map((f) => ({ time: f.time, stamp: stamp(f.time), file: f.rel })),
      credits,
      chapters,
      generatedAt: new Date().toISOString(),
    }),
  ]);
}
