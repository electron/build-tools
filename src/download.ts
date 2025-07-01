import fs from 'node:fs';
import stream from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { fatal } from './utils/logging.js';
import { progressStream } from './utils/download.js';

const write = fs.createWriteStream(process.argv[3]);

async function tryDownload(attemptsLeft = 3) {
  const response = await fetch(process.argv[2]);
  const total = parseInt(response.headers.get('content-length') || '1', 10);

  let promise: Promise<void>;
  if (process.env.CI) {
    promise = pipeline(stream.Readable.fromWeb(response.body!), write);
  } else {
    const progress = progressStream(total, '[:bar] :mbRateMB/s :percent :etas');
    promise = pipeline(stream.Readable.fromWeb(response.body!), progress, write);
  }

  await promise.catch((err) => {
    if (attemptsLeft === 0) {
      return fatal(err);
    }

    console.log('Download failed, trying', attemptsLeft, 'more times');
    tryDownload(attemptsLeft - 1);
  });
}

tryDownload();
