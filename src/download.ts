import * as fs from 'node:fs';
import * as stream from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { fatal } from './utils/logging';
import { progressStream } from './utils/download';

const outPath = process.argv[3];
if (!outPath) {
  fatal('No output path provided for download');
}

const write = fs.createWriteStream(outPath);

async function tryDownload(attemptsLeft = 3): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    return fatal('No URL provided for download');
  }

  const response = await fetch(url);

  if (!response.ok) {
    if (attemptsLeft === 0) {
      return fatal(`Download failed - ${response.status} ${response.statusText}`);
    }
    console.log(`Download failed - trying ${attemptsLeft} more times`);
    return tryDownload(attemptsLeft - 1);
  }

  const total = parseInt(response.headers.get('content-length') ?? '0', 10);
  const progress = progressStream(total, '[:bar] :mbRateMB/s :percent :etas');

  if (!response.body) {
    return fatal('Download failed - no response body');
  }

  const source = stream.Readable.fromWeb(response.body);
  const chain = process.env['CI'] ? pipeline(source, write) : pipeline(source, progress, write);

  await chain.catch((err: unknown) => {
    if (attemptsLeft === 0) {
      return fatal(err);
    }

    console.log('Download failed, trying', attemptsLeft, 'more times');
    return tryDownload(attemptsLeft - 1);
  });
}

void tryDownload();
