const fs = require('fs');
const stream = require('stream');
const { pipeline } = require('stream/promises');

const { fatal } = require('./utils/logging');
const { progressStream } = require('./utils/download');

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
