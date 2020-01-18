const fs = require('fs');
const hasha = require('hasha');

fs.createReadStream(process.argv[2])
  .pipe(hasha.stream({ algorithm: 'md5' }))
  .pipe(process.stdout);
