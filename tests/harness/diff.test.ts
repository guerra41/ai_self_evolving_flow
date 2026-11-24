import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../../src/diff.js';

describe('unifiedDiff', () => {
  it('reports identical text as no change', () => {
    expect(unifiedDiff('a\nb', 'a\nb')).toBe('--- no source change ---');
  });

  it('shows only the changed line plus context, with hunk numbers', () => {
    const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n');
    const after = ['1', '2', '3', '4', 'FIVE', '6', '7', '8', '9', '10'].join('\n');
    expect(unifiedDiff(before, after, 2)).toBe(
      ['--- before', '+++ after', '@@ -3,5 +3,5 @@', ' 3', ' 4', '-5', '+FIVE', ' 6', ' 7'].join('\n'),
    );
  });

  it('ignores line-ending differences', () => {
    expect(unifiedDiff('a\r\nb\r\nc', 'a\nb\nc')).toBe('--- no source change ---');
    const diff = unifiedDiff('a\r\nb\r\nc', 'a\nB\nc', 1);
    expect(diff).toContain('-b');
    expect(diff).toContain('+B');
    expect(diff).not.toContain('-a');
  });

  it('handles pure additions and pure removals', () => {
    expect(unifiedDiff('a\nc', 'a\nb\nc', 1)).toContain('+b');
    expect(unifiedDiff('a\nb\nc', 'a\nc', 1)).toContain('-b');
  });

  it('merges nearby changes into one hunk and splits distant ones', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    const edited = [...lines];
    edited[2] = 'changed-a';
    edited[4] = 'changed-b';
    edited[25] = 'changed-c';
    const hunks = unifiedDiff(lines.join('\n'), edited.join('\n'), 2)
      .split('\n')
      .filter((line) => line.startsWith('@@'));
    expect(hunks).toHaveLength(2);
  });

  it('can be applied: removing the - lines and + lines reconstructs both sides', () => {
    const before = 'x\ny\nz\nw';
    const after = 'x\nY\nz\nw\nextra';
    const diff = unifiedDiff(before, after, 10).split('\n').slice(3);
    const rebuiltBefore = diff.filter((l) => l[0] !== '+').map((l) => l.slice(1)).join('\n');
    const rebuiltAfter = diff.filter((l) => l[0] !== '-').map((l) => l.slice(1)).join('\n');
    expect(rebuiltBefore).toBe(before);
    expect(rebuiltAfter).toBe(after);
  });

  it('falls back to a full replacement for very large inputs instead of exhausting memory', () => {
    const big = Array.from({ length: 2500 }, (_, i) => `a${i}`).join('\n');
    const other = Array.from({ length: 2500 }, (_, i) => `b${i}`).join('\n');
    const diff = unifiedDiff(big, other);
    expect(diff).toContain('-a0');
    expect(diff).toContain('+b2499');
  });
});
