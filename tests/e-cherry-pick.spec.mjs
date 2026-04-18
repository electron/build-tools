import { describe, expect, it } from 'vitest';

import {
  commitSubject,
  computeBatchId,
  formatPRTitleAndBody,
  isUrl,
  splitPositionalArgs,
} from '../dist/e-cherry-pick.js';

const samplePatch = (subject) =>
  [
    'From abc123def4567890 Mon Sep 17 00:00:00 2001',
    'From: Dev <dev@example.com>',
    'Date: Mon, 1 Jan 2024 00:00:00 +0000',
    `Subject: [PATCH] ${subject}`,
    '',
    'Commit body line one.',
    'Commit body line two.',
    '',
    '---',
    ' file.cc | 1 +',
    ' 1 file changed, 1 insertion(+)',
  ].join('\n');

describe('e-cherry-pick.isUrl', () => {
  it('returns true for https urls', () => {
    expect(isUrl('https://chromium-review.googlesource.com/c/v8/v8/+/2465830')).toBe(true);
  });

  it('returns true for http urls', () => {
    expect(isUrl('http://example.com/foo')).toBe(true);
  });

  it('returns false for branch names and plain strings', () => {
    expect(isUrl('main')).toBe(false);
    expect(isUrl('28-x-y')).toBe(false);
    expect(isUrl('')).toBe(false);
  });

  it('returns false for protocol-relative or ftp urls', () => {
    expect(isUrl('//example.com')).toBe(false);
    expect(isUrl('ftp://example.com')).toBe(false);
  });
});

describe('e-cherry-pick.commitSubject', () => {
  it('extracts the subject line of a git format-patch', () => {
    expect(commitSubject(samplePatch('fix: add guard for null input'))).toBe(
      'fix: add guard for null input',
    );
  });

  it('returns empty string when no subject is present', () => {
    expect(commitSubject('no subject line here')).toBe('');
  });

  it('trims trailing whitespace', () => {
    const patch = 'Subject: [PATCH] trailing whitespace   ';
    expect(commitSubject(patch)).toBe('trailing whitespace');
  });

  it('stops at end of line for single-line subjects', () => {
    const patch = 'Subject: [PATCH] first line\nsecond line';
    expect(commitSubject(patch)).toBe('first line');
  });
});

describe('e-cherry-pick.splitPositionalArgs', () => {
  const URL_A = 'https://chromium-review.googlesource.com/c/v8/v8/+/1111';
  const URL_B = 'https://chromium-review.googlesource.com/c/chromium/src/+/2222';

  it('keeps url-first, branch-second order as-is', () => {
    expect(splitPositionalArgs(URL_A, 'main', [])).toEqual({
      patchUrls: [URL_A],
      targetBranches: ['main'],
    });
  });

  it('swaps args when the user passes branch first, url second', () => {
    expect(splitPositionalArgs('main', URL_A, [])).toEqual({
      patchUrls: [URL_A],
      targetBranches: ['main'],
    });
  });

  it('treats additional url positionals as patches', () => {
    expect(splitPositionalArgs(URL_A, 'main', [URL_B])).toEqual({
      patchUrls: [URL_A, URL_B],
      targetBranches: ['main'],
    });
  });

  it('treats additional non-url positionals as target branches', () => {
    expect(splitPositionalArgs(URL_A, 'main', ['28-x-y', '29-x-y'])).toEqual({
      patchUrls: [URL_A],
      targetBranches: ['main', '28-x-y', '29-x-y'],
    });
  });

  it('splits mixed rest args into patches and branches', () => {
    expect(splitPositionalArgs(URL_A, 'main', [URL_B, '28-x-y'])).toEqual({
      patchUrls: [URL_A, URL_B],
      targetBranches: ['main', '28-x-y'],
    });
  });
});

describe('e-cherry-pick.computeBatchId', () => {
  it('is deterministic for the same input', () => {
    const urls = ['https://a.example/1', 'https://b.example/2'];
    expect(computeBatchId(urls)).toBe(computeBatchId(urls));
  });

  it('returns a 12-char hex string', () => {
    const id = computeBatchId(['https://a.example/1']);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('changes when patch URL order changes', () => {
    const a = computeBatchId(['https://a.example/1', 'https://b.example/2']);
    const b = computeBatchId(['https://b.example/2', 'https://a.example/1']);
    expect(a).not.toBe(b);
  });
});

describe('e-cherry-pick.formatPRTitleAndBody', () => {
  it('builds a single-patch title and body with a bug number', () => {
    const { title, body } = formatPRTitleAndBody({
      patches: [
        {
          patchDirName: 'v8',
          shortCommit: 'abc1234',
          patch: samplePatch('fix: do the thing'),
          bugNumber: '123456',
        },
      ],
      security: false,
    });
    expect(title).toBe('chore: cherry-pick abc1234 from v8');
    expect(body).toContain('fix: do the thing');
    expect(body).toContain('Notes: Backported fix for 123456.');
  });

  it('prefers CVE over bug number when security=true', () => {
    const { body } = formatPRTitleAndBody({
      patches: [
        {
          patchDirName: 'v8',
          shortCommit: 'abc1234',
          patch: samplePatch('fix: secure'),
          bugNumber: '123456',
          cve: 'CVE-2024-0001',
        },
      ],
      security: true,
    });
    expect(body).toContain('Notes: Security: backported fix for CVE-2024-0001.');
  });

  it('emits a placeholder note when no bug number is known', () => {
    const { body } = formatPRTitleAndBody({
      patches: [
        {
          patchDirName: 'v8',
          shortCommit: 'abc1234',
          patch: samplePatch('fix: mystery'),
        },
      ],
      security: false,
    });
    expect(body).toContain("<!-- couldn't find bug number -->");
  });

  it('builds a batch title and body with deduped dir names', () => {
    const { title, body } = formatPRTitleAndBody({
      patches: [
        {
          patchDirName: 'v8',
          shortCommit: 'aaaaaaa',
          patch: samplePatch('fix: a'),
          bugNumber: '111',
        },
        {
          patchDirName: 'v8',
          shortCommit: 'bbbbbbb',
          patch: samplePatch('fix: b'),
          cve: 'CVE-2024-0002',
        },
        {
          patchDirName: 'chromium',
          shortCommit: 'ccccccc',
          patch: samplePatch('fix: c'),
        },
      ],
      security: false,
    });
    expect(title).toBe('chore: cherry-pick 3 changes from v8, chromium');
    expect(body).toContain('* aaaaaaa from v8 — fix: a (111)');
    expect(body).toContain('* bbbbbbb from v8 — fix: b (CVE-2024-0002)');
    expect(body).toContain('* ccccccc from chromium — fix: c (ccccccc)');
    expect(body).toContain('Notes: Backported fixes for 111, CVE-2024-0002.');
  });

  it('marks batch notes as security when security=true', () => {
    const { body } = formatPRTitleAndBody({
      patches: [
        {
          patchDirName: 'v8',
          shortCommit: 'aaaaaaa',
          patch: samplePatch('fix: a'),
          cve: 'CVE-2024-0003',
        },
        {
          patchDirName: 'v8',
          shortCommit: 'bbbbbbb',
          patch: samplePatch('fix: b'),
          cve: 'CVE-2024-0004',
        },
      ],
      security: true,
    });
    expect(body).toContain('Notes: Security: backported fixes for CVE-2024-0003, CVE-2024-0004.');
  });

  it('emits a batch placeholder when no bugs or CVEs are known', () => {
    const { body } = formatPRTitleAndBody({
      patches: [
        {
          patchDirName: 'v8',
          shortCommit: 'aaaaaaa',
          patch: samplePatch('fix: a'),
        },
        {
          patchDirName: 'v8',
          shortCommit: 'bbbbbbb',
          patch: samplePatch('fix: b'),
        },
      ],
      security: false,
    });
    expect(body).toContain("<!-- couldn't find bug numbers -->");
  });
});
