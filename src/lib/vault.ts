/**
 * The `meta.json` contract: the data package processing leaves in the vault and
 * that the other commands read back.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Credits } from "./credits.ts";
import type { Chapter } from "./resources.ts";

export interface VaultMeta {
  title: string;
  url: string | null;
  uploader: string | null;
  durationSeconds: number;
  wordCount: number;
  segmentCount: number;
  /** Spoken language (ISO 639-1), detected or given. Missing in older vaults. */
  language?: string;
  frameCount: number;
  frames: { time: number; stamp: string; file: string }[];
  credits: Credits;
  chapters: Chapter[];
  generatedAt: string;
}

/** Reads the vault's meta.json. Returns null when the file is missing or corrupt. */
export async function readMeta(vaultDir: string): Promise<VaultMeta | null> {
  try {
    return JSON.parse(await readFile(join(vaultDir, "meta.json"), "utf8")) as VaultMeta;
  } catch {
    return null;
  }
}

/** Writes the vault's meta.json. */
export async function writeMeta(vaultDir: string, meta: VaultMeta): Promise<void> {
  await writeFile(join(vaultDir, "meta.json"), JSON.stringify(meta, null, 2));
}
