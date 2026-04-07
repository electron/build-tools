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

export interface GerritPatchDetails {
  patchDirName: string;
  shortCommit: string;
  commitId: string;
  patch: string;
  bugNumber: string | undefined;
  cve: string;
}

export async function getGerritPatchDetailsFromURL(
  gerritUrl: URL,
  security?: boolean,
): Promise<GerritPatchDetails> {
  const { host, pathname } = gerritUrl;

  if (!GERRIT_SOURCES.includes(host)) {
    fatal('Unsupported gerrit host');
  }
  const pathMatch = /^\/c\/(.+?)\/\+\/(\d+)/.exec(pathname);
  if (!pathMatch?.[1] || !pathMatch[2]) {
    fatal(`Could not parse gerrit path: ${pathname}`);
  }
  const repo = pathMatch[1];
  const number = pathMatch[2];

  d(`fetching patch from gerrit`);
  const changeId = `${repo}~${number}`;
  const patchUrl = new URL(
    `/changes/${encodeURIComponent(changeId)}/revisions/current/patch`,
    gerritUrl,
  );

  const patch = await fetch(patchUrl)
    .then((resp) => resp.text())
    .then((text) => Buffer.from(text, 'base64').toString('utf8'));

  const commitMatch = /^From ([0-9a-f]+)/.exec(patch);
  if (!commitMatch?.[1]) {
    fatal('Could not extract commit id from patch');
  }
  const commitId = commitMatch[1];

  const bugNumber =
    /^(?:Bug|Fixed)[:=] ?(.+)$/im.exec(patch)?.[1] ?? /^Bug= ?chromium:(.+)$/m.exec(patch)?.[1];

  let cve = '';
  if (security && bugNumber) {
    try {
      cve = (await getCveForBugNr(bugNumber.replace('chromium:', ''))) ?? '';
    } catch (err) {
      d(err);
      console.error(
        `${color.warn} Failed to fetch CVE for ${bugNumber} - you'll need to find it manually`,
      );
    }
  }

  const patchDirMap: Record<string, string> = {
    'chromium-review.googlesource.com:chromium/src': 'chromium',
    'skia-review.googlesource.com:skia': 'skia',
    'webrtc-review.googlesource.com:src': 'webrtc',
  };
  const patchDirName = patchDirMap[`${host}:${repo}`] ?? repo.split('/').reverse()[0] ?? repo;

  const shortCommit = commitId.slice(0, 12);

  return { patchDirName, shortCommit, commitId, patch, bugNumber, cve };
}
