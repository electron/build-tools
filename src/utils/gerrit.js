const d = require('debug')('build-tools:gerrit');

const { getCveForBugNr } = require('./crbug');
const { fatal, color } = require('./logging');

const GERRIT_SOURCES = [
  'chromium-review.googlesource.com',
  'skia-review.googlesource.com',
  'webrtc-review.googlesource.com',
  'pdfium-review.googlesource.com',
  'dawn-review.googlesource.com',
];

async function getGerritPatchDetailsFromURL(gerritUrl, security) {
  const { host, pathname } = gerritUrl;

  if (!GERRIT_SOURCES.includes(host)) {
    fatal('Unsupported gerrit host');
  }
  const [, repo, number] = /^\/c\/(.+?)\/\+\/(\d+)/.exec(pathname);

  d(`fetching patch from gerrit`);
  const changeId = `${repo}~${number}`;
  const patchUrl = new URL(
    `/changes/${encodeURIComponent(changeId)}/revisions/current/patch`,
    gerritUrl,
  );

  const patch = await fetch(patchUrl)
    .then((resp) => resp.text())
    .then((text) => Buffer.from(text, 'base64').toString('utf8'));

  const [, commitId] = /^From ([0-9a-f]+)/.exec(patch);

  const bugNumber =
    /^(?:Bug|Fixed)[:=] ?(.+)$/im.exec(patch)?.[1] || /^Bug= ?chromium:(.+)$/m.exec(patch)?.[1];

  let cve = '';
  if (security) {
    try {
      cve = await getCveForBugNr(bugNumber.replace('chromium:', ''));
    } catch (err) {
      d(err);
      console.error(
        `${color.warn} Failed to fetch CVE for ${bugNumber} - you'll need to find it manually`,
      );
    }
  }

  const patchDirName =
    {
      'chromium-review.googlesource.com:chromium/src': 'chromium',
      'skia-review.googlesource.com:skia': 'skia',
      'webrtc-review.googlesource.com:src': 'webrtc',
    }[`${host}:${repo}`] || repo.split('/').reverse()[0];

  const shortCommit = commitId.substr(0, 12);

  return { patchDirName, shortCommit, commitId, patch, bugNumber, cve };
}

module.exports = {
  getGerritPatchDetailsFromURL,
};
