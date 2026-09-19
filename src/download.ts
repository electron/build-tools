import * as fs from 'node:fs';
import * as stream from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';

import { color, fatal } from './utils/logging.js';
import { progressStream } from './utils/download.js';

const MAX_ATTEMPTS = 5;

const url = process.argv[2];
const outPath = process.argv[3];
if (!url) {
  fatal('No URL provided for download');
}
if (!outPath) {
  fatal('No output path provided for download');
}

class DownloadError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

// Node's fetch() rejects with a bare "TypeError: fetch failed" and hides the
// useful part (ENOTFOUND, ECONNRESET, UND_ERR_CONNECT_TIMEOUT, ...) in a chain
// of `cause`s, so flatten that chain into one readable line.
function describeError(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const { code } = current as { code?: unknown };
      const message = current.message || current.name;
      parts.push(
        typeof code === 'string' && !message.includes(code) ? `${code}: ${message}` : message,
      );
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' -> ');
}

// Timeouts, 5xx (including the CDN's 52x origin errors) and rate limiting are
// worth another go; a 403/404 means the URL is wrong and retrying only delays
// the failure.
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// Errors raised by the local file (ENOSPC, EACCES, missing directory, ...)
// won't be fixed by downloading again.
function isLocalWriteError(err: unknown): boolean {
  const { syscall } = (err ?? {}) as { syscall?: unknown };
  return syscall === 'open' || syscall === 'write' || syscall === 'close';
}

async function downloadOnce(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url!);
  } catch (err) {
    // DNS failures, connect timeouts, TLS errors, resets before headers.
    throw new DownloadError(`request failed (${describeError(err)})`, true);
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new DownloadError(
      `server responded ${response.status} ${response.statusText}`.trim(),
      isRetryableStatus(response.status),
    );
  }
  if (!response.body) {
    throw new DownloadError('response had no body', true);
  }

  const total = parseInt(response.headers.get('content-length') ?? '0', 10);
  // With a Content-Encoding, fetch() hands us decoded bytes, so the byte count
  // on disk won't match Content-Length and can't be used to detect truncation.
  const expectExactLength = total > 0 && !response.headers.get('content-encoding');
  const source = stream.Readable.fromWeb(response.body);
  // A fresh write stream per attempt: a failed pipeline destroys its streams,
  // and a retry must start from an empty file rather than append to a partial one.
  const write = fs.createWriteStream(outPath!);
  const stages: (NodeJS.ReadableStream | NodeJS.WritableStream | NodeJS.ReadWriteStream)[] =
    process.env['CI'] || !total
      ? [source, write]
      : [source, progressStream(total, '[:bar] :mbRateMB/s :percent :etas'), write];

  try {
    await pipeline(stages);
  } catch (err) {
    if (isLocalWriteError(err)) {
      throw new DownloadError(
        `could not write ${color.path(outPath!)} (${describeError(err)})`,
        false,
      );
    }
    throw new DownloadError(
      `transfer interrupted after ${write.bytesWritten} of ${total || '?'} bytes (${describeError(err)})`,
      true,
    );
  }

  if (expectExactLength && write.bytesWritten !== total) {
    throw new DownloadError(
      `incomplete download: got ${write.bytesWritten} of ${total} bytes`,
      true,
    );
  }
}

async function download(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    try {
      await downloadOnce();
      if (attempt > 1) {
        console.log(`${color.info} Download succeeded on attempt ${attempt}/${MAX_ATTEMPTS}`);
      }
      return;
    } catch (err) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const retryable = err instanceof DownloadError ? err.retryable : true;
      const reason = err instanceof DownloadError ? err.message : describeError(err);
      const prefix = `Download attempt ${attempt}/${MAX_ATTEMPTS} of ${color.cmd(url!)} failed after ${elapsed}s: ${reason}`;

      if (!retryable || attempt === MAX_ATTEMPTS) {
        fs.rmSync(outPath!, { force: true });
        return fatal(`${prefix}${retryable ? '' : ' (not retrying)'}`);
      }

      // 1s, 2s, 4s, 8s between attempts.
      const waitSeconds = 2 ** (attempt - 1);
      console.error(`${color.warn} ${prefix}; retrying in ${waitSeconds}s`);
      await sleep(waitSeconds * 1000);
    }
  }
}

await download();
