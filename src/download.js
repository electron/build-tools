const fs = require('fs');
const got = require('got');
const stream = require('stream');
const { promisify } = require('util');
const ProgressBar = require('progress');

const pipeline = promisify(stream.pipeline);

const MB_BYTES = 1025 * 1024;

const progressStream = function(tokens) {
  var pt = new stream.PassThrough();

  pt.on('pipe', function(stream) {
    stream.on('response', function(res) {
      const total = parseInt(res.headers['content-length'], 10);
      const bar = new ProgressBar(tokens, { total: Math.round(total / MB_BYTES) });

      pt.on('data', function(chunk) {
        bar.tick(chunk.length / MB_BYTES);
      });
    });
  });

  return pt;
};

const progress = progressStream('[:bar] :rateMB/s :percent :etas');
const write = fs.createWriteStream(process.argv[3]);

pipeline(
  got.default.stream(process.argv[2]),
  ...(process.env.CI ? [write] : [progress, write]),
).catch(err => {
  console.error(err);
  process.exit(1);
});
