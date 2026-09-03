```
       ╭───╮
       │   │
      ╭╯   ╰╮        ██████╗ ███████╗ ██████╗ █████╗ ███╗   ██╗████████╗
     ╱       ╲       ██╔══██╗██╔════╝██╔════╝██╔══██╗████╗  ██║╚══██╔══╝
    ╱ ░░░░░░░ ╲      ██║  ██║█████╗  ██║     ███████║██╔██╗ ██║   ██║
   │ ░░░░░░░░░ │     ██║  ██║██╔══╝  ██║     ██╔══██║██║╚██╗██║   ██║
   │▒▒▒▒▒▒▒▒▒▒▒│     ██████╔╝███████╗╚██████╗██║  ██║██║ ╚████║   ██║
   │▓▓▓▓▓▓▓▓▓▓▓│     ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝
   ╰───────────╯     video lessons, distilled into study documents
```

# decant

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.2-f9f1e1.svg?logo=bun&logoColor=white&labelColor=14151a)](https://bun.sh)
[![Processing: 100% local](https://img.shields.io/badge/processing-100%25%20local-2ea44f.svg)](#requirements)

Turns video lessons into study documents. Transcribes locally, captures the
frames that matter and assembles a package the AI reads to write the material —
with screenshots embedded, code examples and timestamps.

It is not a transcript. The deliverable is a course document: concepts, tips,
examples, pitfalls and a practical summary.

Code, documentation and the CLI's own output are in English. The documents
generated inside a vault — `NOTES.md`, `BRIEF.md`, `CREDITS.md`, `RESOURCES.md`,
`transcript.md` — and the rendered HTML page are in Brazilian Portuguese, the
language of the material.

## Requirements

### Runtime

**[Bun](https://bun.sh) 1.2+** — the only runtime needed. The whole CLI runs on
it (`Bun.file`, `Bun.Glob`, `import.meta.dir`), including `tsc`.

```bash
curl -fsSL https://bun.sh/install | bash
```

**Node.js is not a project requirement.** Verified: with Bun in `PATH` and Node
out of it, both the CLI and the typecheck run normally. Node/npm only show up if
you install the agent CLIs via `npm i -g` — and even that has an alternative
(see below).

### Media tools

| Binary | What for |
|---|---|
| `ffmpeg` / `ffprobe` | extract audio, sweep the video, capture frames |
| `whisper-cli` | local transcription (whisper.cpp) |
| `yt-dlp` | download from public platforms (skippable if you only use local files) |

The CLI checks for these before doing any work and prints the install command
for **your** platform — the tables below are the same thing, ahead of time.
`yt-dlp` is only demanded when the input is a URL.

**macOS**

```bash
brew install ffmpeg whisper-cpp yt-dlp
```

**Linux** — `ffmpeg` and `yt-dlp` are packaged; whisper.cpp is not, so it is
built once:

```bash
sudo apt install ffmpeg yt-dlp        # Debian/Ubuntu
sudo dnf install ffmpeg yt-dlp        # Fedora — see the note below
sudo pacman -S ffmpeg yt-dlp          # Arch

git clone https://github.com/ggml-org/whisper.cpp
cd whisper.cpp && cmake -B build && cmake --build build --config Release
# then put build/bin/whisper-cli in your PATH
```

> **Fedora:** on a clean install `dnf install ffmpeg` resolves to `ffmpeg-free`,
> which ships without H.264/H.265. Course videos are almost always H.264, so
> enable [RPM Fusion](https://rpmfusion.org/Configuration) and install the full
> `ffmpeg` — otherwise the sweep and the audio extraction fail on real lessons.

**Windows**

```powershell
winget install -e --id Gyan.FFmpeg
winget install -e --id yt-dlp.yt-dlp
# whisper.cpp: build as above, or grab a release binary from the repo
```

There is no runtime npm dependency beyond `marked`, used to render the markdown.
Everything else is a system binary.

### Installing the project

```bash
bun install
```

### Agents (optional)

Only needed for automatic analysis (`--claude`, `--codex`, `--gemini`). Without
them the vault is generated all the same and you write the `NOTES.md` by asking
your usual agent.

| Agent | Via npm (needs Node) | Without Node (macOS) |
|---|---|---|
| Claude Code | `npm i -g @anthropic-ai/claude-code` | `brew install --cask claude-code` |
| Codex | `npm i -g @openai/codex` | `brew install --cask codex` |
| Gemini | `npm i -g @google/gemini-cli` | `brew install gemini-cli` |

On Linux and Windows the npm route is the one available; each agent also ships a
native installer, listed in its own docs.

### Platform support

| | Status |
|---|---|
| **macOS** (Apple Silicon) | tested end to end; whisper.cpp runs on Metal |
| **macOS** (Intel) | expected to work; whisper.cpp falls back to CPU |
| **Linux** | expected to work; every step is the same binary. whisper.cpp is built from source and uses CPU unless you compile it with CUDA/Vulkan |
| **Windows** | expected to work; `--view` opens the browser through `cmd /c start`, and falls back to printing the path if that fails |

Nothing in the pipeline is macOS-only: Bun, `ffmpeg`, `whisper.cpp` and `yt-dlp`
all ship for the three platforms. What differs is how you install them and how
fast the transcription runs. Only the Apple Silicon path has actually been run
end to end — reports from the others are welcome.

**Tested on:** macOS 15 (Apple M2 Pro) · Bun 1.4.0 · ffmpeg 9.0.1 ·
whisper.cpp via `whisper-cpp` · yt-dlp 2026.08.19.

Processing happens entirely on your machine. No audio or video leaves the
computer — important for paid course content.

## Usage

```bash
# local file
bun run decant ./aula-01.mp4

# public platform
bun run decant "https://www.youtube.com/watch?v=..."

# long lesson, more captures, more sensitive to slide changes
bun run decant ./modulo.mp4 --model large --frames 60 --sens 6
```

Then comes the analysis. Either you ask for it in Claude Code:

```
analisa o vault vaults/aula-01 e escreve o NOTES.md
```

Or you make it automatic with a flag:

```bash
bun run decant ./aula-01.mp4 --claude    # calls the agent at the end and writes the NOTES.md
```

## Automatic analysis

| Flag | Agent | Install | Status |
|---|---|---|---|
| `--claude` | Claude Code | `npm i -g @anthropic-ai/claude-code` | tested end to end |
| `--codex` | Codex CLI | `npm i -g @openai/codex` | flags checked, not executed |
| `--gemini` | Gemini CLI | `npm i -g @google/gemini-cli` | failed in testing (see below) |
| `--agent auto` | the first one installed | — | — |

**About Gemini:** on version 0.57.0 the headless run required `--skip-trust`
(already included) and, even so, aborted after ~12min with
`An unexpected critical error occurred:[object Object]` coming from
`GeminiClient` itself. The integration is written and may well work on another
version or with another account setup, but **it was not validated here**. Prefer
`--claude` until it is confirmed.

Each one runs **under that CLI's own subscription** — no API key is involved
here, and nothing is billed per token. All of them are invoked non-interactively
with permission to write files in the working directory, and nothing beyond that
(`acceptEdits` on Claude, `workspace-write` on Codex, `auto_edit` on Gemini).

To rewrite the `NOTES.md` of an existing vault without reprocessing the video:

```bash
bun run analyze vaults/aula-01 --claude
bun run analyze vaults/aula-01 --gemini   # same vault, different agent
```

### Instructions: a single file

**`AGENTS.md` is the only instructions file** — no copy, no symlink. It is the
open standard that Codex and Claude Code look for on their own:

| CLI | Looks for | How we handle it |
|---|---|---|
| Codex | `AGENTS.md` (+ `AGENTS.override.md`) | native |
| Claude Code | `CLAUDE.md` **or** `AGENTS.md` | native |
| Gemini | `GEMINI.md` | `.gemini/settings.json` points at `AGENTS.md` |

Verified in the installed binaries: the Claude Code one states *"Claude Code
hardcodes CLAUDE.md / AGENTS.md discovery"*, and the Codex one has 82 references
to `AGENTS.md` and **none** to `codex.md` or `openai.md` — there is no
OpenAI-specific file, `AGENTS.md` is their convention.

Tested without a `CLAUDE.md` in the repository: Claude Code found `AGENTS.md`
and followed the instructions all the way to the credits and materials sections.

The essentials are also repeated in the prompt itself, so it works even when the
CLI does not load a convention file — the Gemini case, whose `contextFileName`
was checked against the schema but not validated in a run.

## Credits for the original work

Every vault gets a `CREDITS.md` with the authorship of the content, assembled
from three sources:

1. **Platform metadata** — author, channel, publication date and license
2. **Video description** — links preserving the label that introduces them, so
   that "Patrocinio — HOSTNET" does not become a bare domain
3. **The lesson itself** — during the analysis, the agent notes the teacher's
   name said out loud, the names shown on screen and the sources cited

The `NOTES.md` ends with a `## Creditos` section, and the rendered page carries
the attribution in the footer — including when printed to PDF.

## Supporting materials

`RESOURCES.md` separates what serves the study from what is merely a credit: the
channel's Facebook link goes to the credits, the exercises repository goes to the
materials. Links from the description come in grouped by type — **course**,
**code**, **download**, **documentation**, **community** — along with the
**chapters** the platform declares, each with a link to the moment.

In the Curso em Video lesson, for example, the link to the certified course went
to the materials, while social networks and sponsorship stayed in the credits. In
another video, extraction recovered MDN and the Stack Overflow survey cited in
the opening.

During the analysis, the agent fills in the "Citados na aula" section with what
only appears in the content: a URL shown on screen, an address said out loud, a
recommended book or tool. When a URL is said but is not legible, it records the
name and the timestamp instead of guessing the address.

For older vaults, or when the video description has changed:

```bash
bun run credits vaults/aula-01            # re-queries the source (no video download)
bun run credits vaults/aula-01 --offline  # only with what is already in meta.json
```

A local video file has no platform metadata: in that case `CREDITS.md` comes out
with the essentials and the analysis fills in whatever the lesson credits.

## Reading the result

The `NOTES.md` is markdown with screenshots and timestamps — good in the editor,
better in the browser:

```bash
bun run view vaults/aula-01               # renders and opens
bun run view vaults/aula-01 --standalone  # single file, to send to someone
bun run view vaults/aula-01 --file BRIEF.md
```

Without `--standalone` the HTML stays around ~15KB and points at `frames/` next
to it. With it, the images are embedded and the file travels on its own. The page
follows the system's light/dark theme and prints cleanly to PDF (Cmd+P).

The page loads its three typefaces from Google Fonts. That is the only network
call anything here makes, and it happens when a document is *opened*, never
while it is being produced — the processing stays entirely on your machine.
Offline, or if you would rather not touch a CDN, the page falls back to the
system stack and stays perfectly readable.

To do everything in one go — process, analyse and open:

```bash
bun run decant ./aula-01.mp4 --claude --view
```

## Options

| Option | Default | What it does |
|---|---|---|
| `--model` | `turbo` | `small`, `medium`, `turbo`, `large`. `turbo` is the best trade-off on Apple Silicon |
| `--lang` | `auto` | Spoken language (`auto`, `pt`, `en`, `es`...) |
| `--frames` | `40` | Cap on captures in the document |
| `--sens` | `10` | Sensitivity to screen changes, in differing bits (1-64). Lower = more captures. Use `6` for code screencasts |
| `--sample` | `0.5` | Samples per second in the sweep. Raise it for lessons with lots of fast cuts |
| `--width` | `1280` | Width of the captures in pixels |
| `--name` | — | Name of the output vault |
| `--keep-media` | — | Keeps the raw video and audio |
| `--claude` / `--codex` / `--gemini` | — | Analyses and writes the `NOTES.md` at the end |
| `--agent <name>` | — | `claude`, `codex`, `gemini` or `auto` |
| `--view` | — | Renders the `NOTES.md` and opens it in the browser at the end |

The model is downloaded once into `~/.cache/decant/models`.

## Output

```
vaults/<slug>/
├── BRIEF.md        # summary of the processing + frame map
├── transcript.md   # speech with timestamps (input)
├── frames.md       # visual index
├── frames/         # 007-04m12s.jpg — named after the moment
├── meta.json       # structured data
├── CREDITS.md      # authorship of the original work
├── RESOURCES.md    # supporting materials and chapters
├── NOTES.md        # the deliverable: study document
└── NOTES.html      # generated by `view` (not versioned)
```

### Versioning

**The whole `vaults/` directory stays out of git.** A vault is generated output,
not code — the same status as a `dist/`. Three reasons point the same way:

- **it is regenerable** — `bun run decant <source>` rebuilds everything
- **it is third-party content** — the full transcript and captures of the video,
  which `CREDITS.md` itself asks you not to redistribute
- **it is heavy and permanent** — a 14 min lesson yields ~4.5 MB of frames, and
  git never forgets a binary

The repository versions only `src/`, `AGENTS.md`, `README.md` and the config.

If you want to keep your own notes (and only those, without transcript or
captures), carve out an exception in `.gitignore`:

```gitignore
!vaults/meu-curso/
vaults/meu-curso/*
!vaults/meu-curso/NOTES.md
!vaults/meu-curso/CREDITS.md
```

To share a document with the captures embedded, generate the single file instead
of versioning them:

```bash
bun run view vaults/aula-01 --standalone
```

## How it works

1. **Ingestion** — `yt-dlp` for a URL, or the local file directly
2. **Transcription** — `whisper.cpp`, with Metal on Apple Silicon and CPU
   elsewhere unless it was compiled with CUDA/Vulkan
3. **Frames** — the video is swept in a single `ffmpeg` pass that emits 9x8
   grayscale thumbnails straight to stdout (72 bytes per sample, nothing on
   disk). Each sample becomes a dHash perceptual signature, and the Hamming
   distance between neighbouring samples points at where the screen really
   changed; only those moments are recaptured at high resolution.

   The capture does not happen at the moment the change is detected, but once
   the screen **settles**: in edited video the transition fires at the start of
   the animation, and capturing there catches the title sliding in or the code
   half typed. Video that never stops (handheld camera, gameplay) has a 6s
   settle cap.

   `ffmpeg`'s `scene` detector is deliberately not used: it was built for camera
   cuts and scores low on exactly what matters here. Measured on a slide-based
   lesson, the four screen changes scored between 0.039 and 0.177 — a range in
   which any fixed threshold gets half of them wrong. dHash gets all five screens
   right.
4. **Package** — transcript, frames and metadata become the `BRIEF.md`
5. **Analysis** — a CLI agent reads the package and writes the `NOTES.md`,
   whether invoked by a flag or by you, by hand

Steps 2 and 3 run in parallel.

## Known limits

Video where the code is **typed out progressively** over many seconds yields
frames with the snippet half written — the screen changes the whole time and
never settles within the waiting window. In those cases, `--sample 1 --frames 60`
samples more densely and gives the analysis more states to reconstruct the full
example from.

## Copyright

The tool **does not work around DRM or authentication**, by design. `yt-dlp`
covers public platforms; protected sources fail with a message explaining why.

For a paid course you have legitimate access to, the way in is processing a local
file you already have the right to access. The generated notes are personal study
material — do not redistribute the original content or the derived documents
without permission from whoever produced the lesson.

## Contributing

Bug reports and pull requests are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) first — it lists the few rules this project
holds to (Bun only, one runtime dependency, `AGENTS.md` as the single
instructions file) and the places where help is most useful right now.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). For
security reports, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Geison Oriani

The licence covers *this tool*. It says nothing about the lessons you process
with it — that content belongs to whoever produced it, which is why every vault
carries a `CREDITS.md`.
