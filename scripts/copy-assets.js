#!/usr/bin/env node
// Copy non-TS assets that tsc doesn't emit into dist/.
// Kept out of src/ so tsc ignores it and the build doesn't depend on its own output.

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const srcUtils = path.join(root, 'src', 'utils');
const distUtils = path.join(root, 'dist', 'utils');

const assets = ['get-path.bat', 'sdks.json'];

fs.mkdirSync(distUtils, { recursive: true });
for (const asset of assets) {
  fs.copyFileSync(path.join(srcUtils, asset), path.join(distUtils, asset));
}
