const fs = require('fs');
const stream = require('stream');
const { pipeline } = require('stream/promises');
const ProgressBar = require('progress');

const { fatal } = require('./utils/logging');

const MB_BYTES = 1024 * 1024;

const progressStream = function (total, tokens) {
  var pt = new stream.PassThrough();

  pt.on('pipe', function (stream) {
    const bar = new ProgressBar(tokens, { total: Math.round(total) });

    pt.on('data', function (chunk) {
      const elapsed = new Date() - bar.start;
      const rate = bar.curr / (elapsed / 1000);
      bar.tick(chunk.length, {
        mbRate: (rate / MB_BYTES).toFixed(2),
      });
    });
  });

  return pt;
};

const write = fs.createWriteStream(process.argv[3]);

async function tryDownload(attemptsLeft = 3) {
  const response = await fetch(process.argv[2]);
  const total = parseInt(response.headers.get('content-length'), 10);
  const progress = progressStream(total, '[:bar] :mbRateMB/s :percent :etas');

  await pipeline(
    stream.Readable.fromWeb(response.body),
    ...(process.env.CI ? [write] : [progress, write]),
  ).catch((err) => {
    if (attemptsLeft === 0) {
      return fatal(err);
    }

    console.log('Download failed, trying', attemptsLeft, 'more times');
    tryDownload(attemptsLeft - 1);
  });
}

tryDownload();
