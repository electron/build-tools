const fs = require('fs');
const got = require('got');
const progressStream = require('stream-progressbar');
const stream = require('stream');
const { promisify } = require('util');

const pipeline = promisify(stream.pipeline);

const progress = progressStream('[:bar] :rate/bps :percent :etas');
const write = fs.createWriteStream(process.argv[3]);

pipeline(
  got.default.stream(process.argv[2]),
  ...(process.env.CI ? [write] : [progress, write]),
).catch(err => {
  console.error(err);
  process.exit(1);
});
