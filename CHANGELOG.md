# Changelog

Notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- `AGENTS.md` as the only instructions file, discovered natively by Claude Code
  and Codex, and reached by Gemini through `.gemini/settings.json`.

[Unreleased]: https://github.com/thoth-id/decant/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/thoth-id/decant/releases/tag/v0.1.0
