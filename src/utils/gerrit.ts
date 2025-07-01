import debug from 'debug';

import { getCveForBugNr } from './crbug.js';
import { fatal, color } from './logging.js';

const d = debug('build-tools:gerrit');

const GERRIT_SOURCES = [
  'chromium-review.googlesource.com',
  'skia-review.googlesource.com',
  'webrtc-review.googlesource.com',
  'pdfium-review.googlesource.com',
  'dawn-review.googlesource.com',
];

export async function getGerritPatchDetailsFromURL(gerritUrl: URL, security: boolean) {
  const { host, pathname } = gerritUrl;

  if (!GERRIT_SOURCES.includes(host)) {
    fatal('Unsupported gerrit host');
  }
  const result = /^\/c\/(.+?)\/\+\/(\d+)/.exec(pathname);
  if (!result) {
    fatal(`Invalid gerrit URL: ${gerritUrl}`);
  }
  const [, repo, number] = result;

  d(`fetching patch from gerrit`);
  const changeId = `${repo}~${number}`;
  const patchUrl = new URL(
    `/changes/${encodeURIComponent(changeId)}/revisions/current/patch`,
    gerritUrl,
  );

  const patch = await fetch(patchUrl)
    .then((resp) => resp.text())
    .then((text) => Buffer.from(text, 'base64').toString('utf8'));

  const fromResult = /^From ([0-9a-f]+)/.exec(patch);
  if (!fromResult) {
    fatal(`Invalid patch format from gerrit: ${patch}`);
  }
  const [, commitId] = fromResult;

  const bugNumber =
    /^(?:Bug|Fixed)[:=] ?(.+)$/im.exec(patch)?.[1] || /^Bug= ?chromium:(.+)$/m.exec(patch)?.[1];

  if (!bugNumber) {
    fatal(`No bug number found in patch: ${patch}`);
  }

  let cve: string | null = null;
  if (security) {
    try {
      cve = await getCveForBugNr(parseInt(bugNumber.replace('chromium:', ''), 10));
    } catch (err) {
      d(err);
      console.error(
        `${color.warn} Failed to fetch CVE for ${bugNumber} - you'll need to find it manually`,
      );
    }
  }

  const hostMap: Record<string, string | undefined> = {
    'chromium-review.googlesource.com:chromium/src': 'chromium',
    'skia-review.googlesource.com:skia': 'skia',
    'webrtc-review.googlesource.com:src': 'webrtc',
  };
  const patchDirName: string = hostMap[`${host}:${repo}`] || repo.split('/').reverse()[0];

  const shortCommit = commitId.substr(0, 12);

  return { patchDirName, shortCommit, patch, bugNumber, cve };
}
