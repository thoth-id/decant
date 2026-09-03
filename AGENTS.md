# decant — analysis instructions

> **Single source of instructions for this repository.**
> `AGENTS.md` is the only instructions file: Claude Code and Codex discover it
> on their own, and Gemini reaches it through `.gemini/settings.json`. Edit here.

This repository turns video lessons into study material. The CLI does the
mechanical part (transcribing, capturing frames); **the analysis and the writing
of the final document are done by an agent** — invoked by a flag (`--claude`,
`--codex`, `--gemini`) or by you, by hand.

The codebase, its documentation and everything the CLI prints are written in
English. The deliverable is not: the documents generated inside a vault —
`NOTES.md`, `BRIEF.md`, `CREDITS.md`, `RESOURCES.md`, `transcript.md` — and the
rendered HTML page are written in Brazilian Portuguese, because that is the
language of the audience studying from them.

## Flow

```bash
bun run decant <url-or-file>               # creates vaults/<slug>/ with BRIEF.md
bun run decant <url-or-file> --claude      # and writes the NOTES.md too
bun run analyze vaults/<slug> --claude # analysis only, no video reprocessing
```

## Writing the NOTES.md

When you get that request, read `BRIEF.md`, `transcript.md` and `meta.json` from
the vault, open the relevant frames and produce `NOTES.md`.

**The goal is not to transcribe.** The transcript already exists in
`transcript.md` and is only raw input. `NOTES.md` is a study document: someone
who did not watch the video should be able to learn the content from it alone.

### Extract

- **Teachings** — the concept, explained so it stands on its own
- **Tips and heuristics** — practical rules, "always do X", "prefer Y"
- **Examples and code** — transcribed faithfully, in a code block with the right
  language. Read the text straight from the frame when the audio is imprecise:
  speakers dictate symbol names badly, the screen shows them right.
- **Common mistakes and pitfalls** — what the instructor warns against
- **Commands, tools, versions, shortcuts** mentioned
- **References** — links, docs and materials mentioned

### Discard

Greetings, requests for likes and subscriptions, digressions, repetitions,
speech corrections, everything that teaches nothing.

### Format

- A title, and a 2-3 line opening saying what the lesson covers and who it serves
- Sections by subject, **in didactic order** — not necessarily the video's order
- Every relevant point anchored with a `[12:34]` timestamp; if `meta.json` has a
  YouTube `url`, use a clickable link `[12:34](url&t=754s)`
- Frames embedded as `![description](frames/file.jpg)` **only where the image
  adds something** (code on screen, a diagram, a command's output). A frame of a
  talking head does not belong.
- Code blocks always with a language: ```sql, ```ts, ```bash
- Close with **Resumo pratico**: the actionable points in a short list

### Credits (mandatory)

The content belongs to someone else. Every `NOTES.md` ends with a `## Creditos`
section naming the author/channel and pointing at the original work — the data
is in `CREDITS.md`, built from the platform's metadata.

While analysing, also collect the credits that only appear in the content:

- the name of the teacher or presenter said out loud
- names shown on screen: opening, footer, signature, watermark
- authors, books, articles and documentation cited
- tools and projects credited

Write those names in the **"Creditos citados na aula"** section of `CREDITS.md`,
in place of the HTML comment. **Never invent a name**: if the lesson credits
nobody explicitly, record that there was no mention.

### Supporting materials

`RESOURCES.md` carries what came from the description, already split by type
(course, code, download, documentation, community) plus the chapters the
platform declares. If there is useful material, add a
`## Materiais complementares` section to the `NOTES.md`.

Also collect what only exists inside the video:

- a URL shown on screen (slide, terminal, browser)
- an address said out loud, or the classic "link in the description"
- a recommended book, article or documentation page
- a tool, library, install command

Write it in the **"Citados na aula"** section of `RESOURCES.md`. When the URL is
said but is not legible, **record the resource name and the timestamp** instead
of guessing the address.

When `meta.json` has chapters, use them as the document's skeleton whenever they
make didactic sense — it is the structure the work itself declared.

### Rules

- Write in Brazilian Portuguese, with correct accents
- Do not invent: if something was inaudible or ambiguous, write `_[inaudivel ~12:30]_`
- Do not pad. A 10-minute lesson that teaches three things becomes a short
  document — that is success, not failure.
- If the video is not didactic (there is nothing being taught), say so instead of
  forcing a course document out of it.

## Structure of a vault

```
vaults/<slug>/
├── BRIEF.md        # technical summary of the processing + frame map
├── transcript.md   # speech with timestamps (input, not the deliverable)
├── frames.md       # visual index of the captures
├── frames/         # JPGs named after the moment: 007-04m12s.jpg
├── meta.json       # structured data
├── CREDITS.md      # authorship of the original work
├── RESOURCES.md    # supporting materials and chapters
└── NOTES.md        # DELIVERABLE — the study document
```

## Limits of the tool

`yt-dlp` covers public platforms. Sources with DRM or that require an
authenticated session fail on purpose — the tool does not work around
protection. For paid course content, the way in is a local file the user has the
right to access.
