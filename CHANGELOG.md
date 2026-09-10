# Changelog

Notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `DECANT_VAULTS` pins the vaults to one directory, so they stop landing in
  whatever directory the command ran from. It has to be an absolute path — a
  leading `~` is expanded even when the shell left it quoted — and only its
  last level is created: a missing parent stops the run instead of building a
  tree where nobody will look for the vaults.
- `view`, `analyze` and `credits` take a vault's name as well as its path,
  looking the name up in the vaults directory: `decant view lesson-01`.

### Changed

- The analysis agent runs inside the vault instead of the directory the
  command ran from, and the prompt names the vault's files relative to it.
  Every agent may only write where it runs, so a vault outside that directory
  was out of its reach.
- The prompt the CLI suggests for asking Claude Code by hand is in English,
  like the rest of its output, and so are the example names in the help. The
  documents inside a vault stay in Brazilian Portuguese.

### Fixed

- A run that fails before producing a vault no longer leaves an empty
  `vaults/` behind in the directory it ran from.

## [0.2.0] — 2026-09-10

### Added

- `--cookies-from-browser <name>` and `--cookies <file>`, passed through to
  yt-dlp for both the metadata query and the download, and accepted by
  `decant credits` too. YouTube refuses signed-out requests for public videos
  with a bot check; the way through is the session you already have, not a way
  around any protection.

### Fixed

- The failure message for a URL no longer explains every yt-dlp error as DRM.
  A bot check now says what it is and names the flag that solves it, instead of
  sending you to look for a local copy of a video you can simply sign in to
  watch.
- An interrupted or failed run no longer leaves the extracted audio behind. The
  `.work` directory — 26MB for a 15-minute lesson — was removed only when the
  run succeeded, and the half-built vault it sat in then refused to rebuild
  without `--force`.
- The analysis is told not to reproduce song lyrics, poems or other third-party
  texts a lesson quotes. The prompt asks for what is on screen to be transcribed
  faithfully, and on a lesson that played a song Claude did exactly that to the
  lyrics — the output got blocked and the run died with
  `Output blocked by content filtering policy`. It now names the work and
  quotes one short line at most.

## [0.1.0] — 2026-09-03

First release.

### Added

- `decant <url-or-file>` — transcribes a video lesson with whisper.cpp and
  captures the frames where the screen actually changes, assembling a vault
  ready for analysis.
- Frame selection by dHash perceptual signature over a single ffmpeg sweep,
  capturing once the screen settles rather than when a transition starts.
- Automatic analysis with `--claude`, `--codex` or `--gemini`, each running
  under that CLI's own subscription. Claude Code is tested end to end; Gemini
  is written but was not validated.
- `decant analyze` rewrites the `NOTES.md` of an existing vault without reprocessing
  the video.
- `decant credits` re-queries the source to rebuild `CREDITS.md` and `RESOURCES.md`.
- `decant view` renders a vault document as an HTML page, with `--standalone` to embed
  the images into a single file.
- `--view` renders and opens the result at the end, so
  `decant <video> --claude --view` processes, analyses and opens in one go.
- `AGENTS.md` as the only instructions file, discovered natively by Claude Code
  and Codex, and reached by Gemini through `.gemini/settings.json`. The prompt
  handed to the agent repeats everything essential, so an install without that
  file loses nothing.

### Requires

Bun 1.2+, and `ffmpeg`, `whisper-cli` and `yt-dlp` on the PATH
(`brew install ffmpeg whisper-cpp yt-dlp`). Vaults are written to a `vaults/`
directory under wherever the command is run.

[Unreleased]: https://github.com/thoth-id/decant/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/thoth-id/decant/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thoth-id/decant/releases/tag/v0.1.0
