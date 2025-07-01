import * as stream from 'node:stream';
import ProgressBar from 'progress';

const MB_BYTES = 1024 * 1024;

export const progressStream = function (total: number, tokens: string) {
  var pt = new stream.PassThrough();

  pt.on('pipe', function (_stream) {
    const bar = new ProgressBar(tokens, { total: Math.round(total) });
    let start: number = 0;

    pt.on('data', function (chunk) {
      if (start === 0) {
        start = +new Date();
      }
      const elapsed = +new Date() - start;
      const rate = bar.curr / (elapsed / 1000);
      bar.tick(chunk.length, {
        mbRate: (rate / MB_BYTES).toFixed(2),
      });
    });
  });

  return pt;
};
