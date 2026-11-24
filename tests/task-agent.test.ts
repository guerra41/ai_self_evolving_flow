import { describe, expect, it } from 'vitest';
import { solveTask } from '../src/task-agent/TaskAgent.js';

describe('TaskAgent', () => {
  it('transforms text to uppercase', () => {
    expect(solveTask({ kind: 'upper', input: 'hello world' })).toBe('HELLO WORLD');
  });

  it('transforms text to lowercase', () => {
    expect(solveTask({ kind: 'lower', input: 'Hello WORLD' })).toBe('hello world');
  });

  it('reverses text', () => {
    expect(solveTask({ kind: 'reverse', input: 'abc' })).toBe('cba');
  });

  it('counts words', () => {
    expect(solveTask({ kind: 'word_count', input: '  one two   three  ' })).toBe(3);
  });

  it('sums numbers', () => {
    expect(solveTask({ kind: 'sum_numbers', input: [2, 3, 5] })).toBe(10);
  });

  it('finds the maximum number', () => {
    expect(solveTask({ kind: 'max_number', input: [7, 2, 9, 4] })).toBe(9);
  });

  it('checks palindromes', () => {
    expect(solveTask({ kind: 'palindrome', input: 'Never odd or even' })).toBe(true);
  });

  it('creates slugs', () => {
    expect(solveTask({ kind: 'slugify', input: '  Hello, New World!  ' })).toBe('hello-new-world');
  });
});

describe('TaskAgent edge cases', () => {
  it('handles empty text', () => {
    expect(solveTask({ kind: 'upper', input: '' })).toBe('');
    expect(solveTask({ kind: 'lower', input: '' })).toBe('');
    expect(solveTask({ kind: 'reverse', input: '' })).toBe('');
  });

  it('counts zero words in blank text', () => {
    expect(solveTask({ kind: 'word_count', input: '   ' })).toBe(0);
  });

  it('sums an empty array to zero', () => {
    expect(solveTask({ kind: 'sum_numbers', input: [] })).toBe(0);
  });

  it('returns zero as the maximum of an empty array', () => {
    expect(solveTask({ kind: 'max_number', input: [] })).toBe(0);
  });

  it('rejects text that is not a palindrome', () => {
    expect(solveTask({ kind: 'palindrome', input: 'hello world' })).toBe(false);
  });

  it('collapses repeated separators in slugs', () => {
    expect(solveTask({ kind: 'slugify', input: 'a  --  b' })).toBe('a-b');
  });
});
