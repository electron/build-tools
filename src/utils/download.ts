import { PassThrough } from 'node:stream';

import ProgressBar from 'progress';

const MB_BYTES = 1024 * 1024;

export function progressStream(total: number, tokens: string): PassThrough {
  const pt = new PassThrough();

  pt.on('pipe', () => {
    const bar = new ProgressBar(tokens, { total: Math.round(total) });
    const start = Date.now();

    pt.on('data', (chunk: Buffer) => {
      const elapsed = Date.now() - start;
      const rate = elapsed > 0 ? bar.curr / (elapsed / 1000) : 0;
      bar.tick(chunk.length, {
        mbRate: (rate / MB_BYTES).toFixed(2),
      });
    });

    // If the transfer dies part way through, finish the bar's line so whatever
    // is logged next doesn't get appended to a half-drawn bar.
    pt.on('close', () => {
      if (!bar.complete) bar.terminate();
    });
  });

  return pt;
}
