import { describe, expect, it } from 'vitest';

import { getPullNumberFromSubject } from '../dist/e-open.js';
import { findNoteInPRBody } from '../dist/e-pr.js';
import { compareChromiumVersions } from '../dist/e-rcv.js';

describe('e-open.getPullNumberFromSubject', () => {
  it('extracts a trailing PR number', () => {
    expect(getPullNumberFromSubject('feat: added foo (#1234)')).toBe(1234);
  });

  it('returns null when no PR reference is present', () => {
    expect(getPullNumberFromSubject('feat: added foo')).toBeNull();
  });

  it('ignores mid-subject numbers', () => {
    expect(getPullNumberFromSubject('fix: issue #99 handling')).toBeNull();
  });

  it('requires a preceding space', () => {
    expect(getPullNumberFromSubject('(#1234)')).toBeNull();
    expect(getPullNumberFromSubject('x (#1234)')).toBe(1234);
  });
});

describe('e-pr.findNoteInPRBody', () => {
  it('finds a single-line notes entry', () => {
    const body = 'Some PR body\nnotes: This is the note\nmore text';
    expect(findNoteInPRBody(body)).toBe('This is the note');
  });

  it('finds a multi-line notes block', () => {
    const body = 'Body text\nNotes:\n\n* First note\n* Second note\n';
    expect(findNoteInPRBody(body)).toBe('* First note\n* Second note');
  });

  it('strips HTML comments from notes', () => {
    const body = 'notes: Real note <!-- template hint -->';
    expect(findNoteInPRBody(body)).toBe('Real note');
  });

  it('returns null when no notes are present', () => {
    expect(findNoteInPRBody('just a regular PR body')).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const body = 'Body\r\nnotes: CRLF note\r\n';
    expect(findNoteInPRBody(body)).toBe('CRLF note');
  });
});

describe('e-rcv.compareChromiumVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareChromiumVersions('120.0.6099.0', '120.0.6099.0')).toBe(0);
  });

  it('returns positive when v1 > v2', () => {
    expect(compareChromiumVersions('120.0.6099.1', '120.0.6099.0')).toBe(1);
    expect(compareChromiumVersions('121.0.0.0', '120.0.6099.0')).toBe(1);
  });

  it('returns negative when v1 < v2', () => {
    expect(compareChromiumVersions('120.0.6099.0', '120.0.6099.1')).toBe(-1);
    expect(compareChromiumVersions('119.0.0.0', '120.0.6099.0')).toBe(-1);
  });

  it('compares numerically, not lexically', () => {
    expect(compareChromiumVersions('120.0.10.0', '120.0.9.0')).toBe(1);
  });

  it('throws when segment counts differ', () => {
    expect(() => compareChromiumVersions('120.0.0', '120.0.0.0')).toThrow();
  });
});
