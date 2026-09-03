# Changelog

Notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/thoth-id/decant/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/thoth-id/decant/releases/tag/v0.1.0
