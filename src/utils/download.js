const stream = require('stream');
const ProgressBar = require('progress');

const MB_BYTES = 1024 * 1024;

const progressStream = function (total, tokens) {
  var pt = new stream.PassThrough();

  pt.on('pipe', function (_stream) {
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

module.exports = {
  progressStream,
};
