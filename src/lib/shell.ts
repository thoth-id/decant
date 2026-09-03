import { spawn } from "node:child_process";

/** stderr lines kept around to compose the error message. */
const STDERR_TAIL = 12;

export class CommandError extends Error {
  constructor(readonly cmd: string, readonly code: number, readonly stderr: string) {
    super(`\`${cmd}\` failed (exit code ${code})\n${stderr.trim()}`);
    this.name = "CommandError";
  }
}

export interface RunOptions {
  /** Called for each stderr line while the process runs (ffmpeg/whisper progress). */
  onStderr?: (line: string) => void;
  /** Echo stdout/stderr straight to the terminal instead of capturing them. */
  inherit?: boolean;
}

/**
 * Runs an external binary without going through a shell — arguments are never
 * interpolated — and returns the raw stdout.
 *
 * stderr is not accumulated in full: long-running processes (yt-dlp, whisper)
 * emit progress continuously and only the last lines matter for the error.
 */
export function runBinary(cmd: string, args: string[], opts: RunOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    const chunks: Buffer[] = [];
    const tail: string[] = [];
    let pending = "";

    child.stdout?.on("data", (c: Buffer) => chunks.push(c));

    child.stderr?.on("data", (chunk: Buffer) => {
      // ffmpeg reports progress with \r; normalize it so we can handle line by line.
      pending = (pending + chunk.toString()).replace(/\r/g, "\n");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        opts.onStderr?.(line);
        if (tail.push(line) > STDERR_TAIL) tail.shift();
      }
    });

    child.on("error", (err) => reject(new Error(`could not run \`${cmd}\`: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new CommandError(cmd, code ?? -1, [...tail, pending].join("\n")));
    });
  });
}

/** Runs an external binary and returns stdout as text. */
export async function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<string> {
  return (await runBinary(cmd, args, opts)).toString();
}

/**
 * First line of an error message. Command failures carry a stderr tail that is
 * useful on its own but too long to inline into another message.
 */
export function firstLine(err: unknown): string {
  return String((err as Error)?.message ?? err).split("\n")[0]!;
}

/** True when the binary exists in PATH. */
export function has(cmd: string): boolean {
  return Bun.which(cmd) !== null;
}
