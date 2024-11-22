#!/usr/bin/env node

const fs = require('fs');
const { ARTIFACTS_DIR, getStaleArtifacts } = require('./utils/artifacts');

const program = require('commander');
const { color, fatal } = require('./utils/logging');

function clean(options) {
  try {
    if (options.stale) {
      const staleFiles = getStaleArtifacts();
      staleFiles.forEach((file) => {
        const filePath = path.join(ARTIFACTS_DIR, file);
        fs.rmSync(filePath, { recursive: true, force: true });
      });
      console.log(color.success, `${staleFiles.length} stale artifact(s) removed.`);
    } else {
      fs.rmSync(ARTIFACTS_DIR, { recursive: true, force: true });
      console.log(color.success, 'Artifacts directory cleaned successfully.');
    }
  } catch (error) {
    fatal(error);
  }
}

program.action(clean).option('--stale', 'Only clean stale artifacts');

program.parse(process.argv);
