const path = require('path');
const { localStorage } = require('./local-storage');
const fs = require('fs');

const ARTIFACTS_DIR = path.join(__dirname, '..', '..', 'artifacts');

/** How often to check for stale files. */
const STALE_CHECK_INTERVAL = 7 * 24 * 60 * 60 * 1000; // 1 week

/** How old a file is to be considered stale. */
const STALE_FILE_AGE = 30 * 24 * 60 * 60 * 1000; // 1 month

function getStaleArtifacts() {
  const now = Date.now();
  let files;
  try {
    files = fs.readdirSync(ARTIFACTS_DIR);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    return [];
  }
  const staleFiles = files.filter((file) => {
    const filePath = path.join(ARTIFACTS_DIR, file);
    const stats = fs.statSync(filePath);
    return stats.mtimeMs < now - STALE_FILE_AGE;
  });
  return staleFiles;
}

function maybeCheckStaleArtifacts() {
  const lastChecked = parseInt(localStorage.getItem('lastArtifactsCheck'), 10);
  const now = Date.now();

  if (!lastChecked || lastChecked < now - STALE_CHECK_INTERVAL) {
    const staleArtifacts = getStaleArtifacts();
    if (staleArtifacts.length > 0) {
      console.warn(
        `Stale artifact(s) found:\n\t${staleArtifacts.join('\n\t')}\n\nRun 'e clean --stale' to cleanup artifacts.`,
      );
    }
    localStorage.setItem('lastArtifactsCheck', now);
  }
}

module.exports = {
  ARTIFACTS_DIR,
  getStaleArtifacts,
  maybeCheckStaleArtifacts,
};
