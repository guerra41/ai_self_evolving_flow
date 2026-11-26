import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateProposal, SYSTEM_PROMPT } from '../../src/proposer.js';

const REPLY = { choices: [{ message: { content: '```typescript\nexport const x = 1;\n```' } }] };

let requests: Array<{ url: string; init: RequestInit }> = [];
const saved = { key: process.env.OPENAI_API_KEY, url: process.env.OPENAI_BASE_URL };

beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    requests.push({ url, init });
    return new Response(JSON.stringify(REPLY), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [name, value] of [['OPENAI_API_KEY', saved.key], ['OPENAI_BASE_URL', saved.url]] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('generateProposal request', () => {
  it('sends only the allowed inputs, including the attempt history', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1';
    delete process.env.OPENAI_API_KEY;
    const attempts = [{ outcome: 'not_better', change: 'formatting_only', score: 63, diff: '-\n', times: 3 }] as const;
    const result = await generateProposal('SOURCE', ['Uppercase text.'], [63, 63], [...attempts]);

    expect(result.source).toBe('export const x = 1;');
    const body = JSON.parse(String(requests[0].init.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
    expect(JSON.parse(body.messages[1].content)).toEqual({
      trainingPrompts: ['Uppercase text.'],
      pastScores: [63, 63],
      previousAttempts: attempts,
      currentSource: 'SOURCE',
    });
  });

  it('tells the model not to repeat unproductive changes or touch formatting', () => {
    expect(SYSTEM_PROMPT).toContain('Never repeat a change that did not raise the score');
    expect(SYSTEM_PROMPT).toContain('whitespace');
    expect(SYSTEM_PROMPT).not.toMatch(/eval\/|expected\.json/);
  });

  it('defaults to an empty history', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1';
    await generateProposal('SOURCE', [], []);
    const body = JSON.parse(String(requests[0].init.body)) as { messages: Array<{ content: string }> };
    expect(JSON.parse(body.messages[1].content).previousAttempts).toEqual([]);
  });

  it('sends no Authorization header without a key, and a Bearer header with one', async () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1';
    delete process.env.OPENAI_API_KEY;
    await generateProposal('S', [], []);
    process.env.OPENAI_API_KEY = 'test-key';
    await generateProposal('S', [], []);
    expect((requests[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect((requests[1].init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('refuses to run with neither a key nor a base URL', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    await expect(generateProposal('S', [], [])).rejects.toThrow(/OPENAI_BASE_URL/);
  });
});
