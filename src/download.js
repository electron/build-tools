const fs = require('fs');
const got = require('got');
const stream = require('stream');
const { pipeline } = require('stream/promises');
const ProgressBar = require('progress');

const { fatal } = require('./utils/logging');

const MB_BYTES = 1024 * 1024;

const progressStream = function(tokens) {
  var pt = new stream.PassThrough();

  pt.on('pipe', function(stream) {
    stream.on('response', function(res) {
      const total = parseInt(res.headers['content-length'], 10);
      const bar = new ProgressBar(tokens, { total: Math.round(total) });

      pt.on('data', function(chunk) {
        const elapsed = new Date() - bar.start;
        const rate = bar.curr / (elapsed / 1000);
        bar.tick(chunk.length, {
          mbRate: (rate / MB_BYTES).toFixed(2),
        });
      });
    });
  });

  return pt;
};

const progress = progressStream('[:bar] :mbRateMB/s :percent :etas');
const write = fs.createWriteStream(process.argv[3]);

function tryDownload(attemptsLeft = 3) {
  pipeline(
    got.default.stream(process.argv[2]),
    ...(process.env.CI ? [write] : [progress, write]),
  ).catch(err => {
    if (attemptsLeft === 0) {
      return fatal(err);
    }

    console.log('Download failed, trying', attemptsLeft, 'more times');
    tryDownload(attemptsLeft - 1);
  });
}

tryDownload();
