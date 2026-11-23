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
