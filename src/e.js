import path from 'node:path';

// Hacky shim to route src/e --> dist/e
process.argv[1] = process.argv[1].replace(
  import.meta.dirname,
  path.resolve(import.meta.dirname, '../dist'),
);

import('../dist/e.js');
