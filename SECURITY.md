# Security Policy

## Reporting a vulnerability

Report privately through GitHub Security Advisories — the **Security** tab of
this repository, then **Report a vulnerability**. Please do not open a public
issue for a security problem.

You can expect an initial reply within a few days. This is a small project
maintained in spare time, so please be patient with follow-ups.

## What is in scope

The tool shells out to `ffmpeg`, `ffprobe`, `whisper-cli` and `yt-dlp`, and
passes user input (file paths, URLs, option values) to them. It also invokes
agent CLIs non-interactively with permission to write files in the working
directory. Problems worth reporting include:

- command or argument injection through a file path, URL or option value
- a path traversal that writes outside the intended vault directory
- an agent invocation that grants broader permissions than documented
  (`acceptEdits` on Claude, `workspace-write` on Codex, `auto_edit` on Gemini)

## Passing cookies

`--cookies-from-browser` and `--cookies` hand yt-dlp a real session. A YouTube
cookie is your Google account: treat it as a password, not as configuration.

- **Prefer `--cookies-from-browser`.** It reads the browser's store for that one
  request and writes nothing. On macOS the browser will ask for Keychain
  access — that prompt is expected.
- **A `cookies.txt` is a live credential on disk.** It is git-ignored here, but
  it is still a file anyone with read access to that directory can use. Delete
  it when you are done, and never commit or share one.
- **Mind the agent.** `--claude`, `--codex` and `--gemini` run an agent with
  write permission in the working directory, so anything readable there is
  readable by it. That is one more reason not to leave a `cookies.txt` beside
  your vaults.
- The cookies are passed to yt-dlp as arguments and never written to the vault,
  the logs or `meta.json`.

## What is out of scope

- Vulnerabilities in `ffmpeg`, `whisper.cpp` or `yt-dlp` themselves — report
  those upstream.
- The fact that the tool does not work around DRM or authentication. That is
  deliberate, and reports asking for it will be closed.
- Content processed by the tool staying on your machine is the design; there is
  no server and no telemetry. The network is touched in exactly three places:
  `yt-dlp` fetching a public video, the one-time Whisper model download, and the
  rendered HTML page loading its typefaces from Google Fonts — that last one at
  reading time, in the reader's browser, never while a video is processed.
