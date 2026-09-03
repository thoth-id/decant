# Contributing

Thanks for taking an interest. This is a small, opinionated tool — the fastest
way to get a change merged is to understand the few rules it holds to.

## Setup

```bash
brew install ffmpeg whisper-cpp yt-dlp
curl -fsSL https://bun.sh/install | bash
bun install
```

Then process any local video to check your environment works end to end:

```bash
bun run decant ./some-video.mp4
```

## Before opening a pull request

```bash
bun run typecheck
```

That is the whole gate. There is no test suite yet — if you are adding logic
that is worth pinning down, adding one is welcome.

## The rules this project holds to

**Bun only, no Node.** The CLI runs on `Bun.file`, `Bun.Glob` and
`import.meta.dir`. A change that reintroduces a Node-only API, or that requires
`node` in `PATH`, will not be merged.

**One runtime dependency.** The only npm package at runtime is `marked`, for
rendering markdown. Everything else is a system binary (`ffmpeg`, `whisper-cli`,
`yt-dlp`). Adding a second npm dependency needs a strong reason — say so in the
pull request.

**English in the code, Brazilian Portuguese in the vaults.** Source, comments,
documentation and everything the CLI prints are in English. The documents
generated inside a vault — `NOTES.md`, `BRIEF.md`, `CREDITS.md`, `RESOURCES.md`
— are in Brazilian Portuguese, because that is the language of the people
studying from them.

**`AGENTS.md` is the only instructions file.** No `CLAUDE.md`, no `GEMINI.md`,
no copies and no symlinks. Claude Code and Codex discover `AGENTS.md` natively;
Gemini reaches it through `.gemini/settings.json`. Edit the one file.

**`vaults/` never enters git.** A vault is generated output, and it holds
third-party content — the transcript and screen captures of someone else's
lesson. Regenerate it instead of committing it.

**Nothing works around DRM or authentication.** This is a design decision, not
a missing feature. Pull requests that add ways to capture protected streams
will be closed.

## Where help is most useful

- **Validating the Gemini integration.** It is written but was never confirmed
  working — see the note in the README. A run that succeeds, with the version
  you used, would settle it.
- **The progressive-typing case.** Video where code is typed out over many
  seconds yields frames with the snippet half written. The current workaround
  is `--sample 1 --frames 60`; a smarter settle heuristic would be better.
- **Platforms beyond what `yt-dlp` covers well**, for public content.

## Commits

Short, imperative subject lines describing what the change does. Keep unrelated
changes in separate commits.

## Releasing

For maintainers: [RELEASING.md](RELEASING.md) covers the one-time npm setup and
the two commands that cut a version.
