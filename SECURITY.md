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
