import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, posix, relative, sep } from 'node:path';

/**
 * Files the MetaAgent must never change. Everything under src/task-agent/ is the
 * only thing it may edit, so it is deliberately not listed here.
 */
const PROTECTED_DIRECTORIES = ['tests', 'eval', 'training'];
const PROTECTED_SRC_FILES = ['cli.ts', 'evaluator.ts', 'sandbox.ts', 'meta-agent.ts', 'isolation.ts', 'guard.ts', 'test-runner.ts'];
const PROTECTED_ROOT_FILES = ['package.json', 'pnpm-lock.yaml', 'tsconfig.json'];

export type Manifest = Record<string, string>;

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/** SHA-256 of every protected file, keyed by a forward-slash path relative to root. */
export async function protectedManifest(root = process.cwd()): Promise<Manifest> {
  const files = [
    ...(await Promise.all(PROTECTED_DIRECTORIES.map((dir) => listFiles(join(root, dir))))).flat(),
    ...PROTECTED_SRC_FILES.map((file) => join(root, 'src', file)),
    ...PROTECTED_ROOT_FILES.map((file) => join(root, file)),
  ];

  const manifest: Manifest = {};
  for (const file of files.sort()) {
    const key = relative(root, file).split(sep).join(posix.sep);
    const content = await readFile(file).catch(() => null);
    manifest[key] = content ? createHash('sha256').update(content).digest('hex') : 'missing';
  }
  return manifest;
}

/** Returns the protected paths that were added, removed or modified. */
export function manifestChanges(before: Manifest, after: Manifest): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((path) => before[path] !== after[path]).sort();
}

const FORBIDDEN_PATTERNS: Array<[RegExp, string]> = [
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\brequire\s*\(/, 'require()'],
  [/\bfrom\s+['"](?!\.{1,2}\/)[^'"]+['"]/, 'import of an external or built-in module'],
  [/\bimport\s+['"]/, 'side-effect import'],
  [/\bprocess\b/, 'process'],
  [/\bglobalThis\b/, 'globalThis'],
  [/\b(?:eval|Function)\s*\(/, 'eval / Function constructor'],
  [/\b(?:fetch|XMLHttpRequest|WebSocket)\b/, 'network access'],
  [/\b(?:child_process|worker_threads|node:)/, 'Node built-in module'],
  [/\b(?:Deno|Bun)\b/, 'alternate runtime global'],
];

/**
 * Static screen applied to a proposed TaskAgent source BEFORE it is written to disk,
 * so rejected code is never executed. TaskAgent is a pure function; it needs no I/O.
 * This is a defence layer, not a proof of safety: isolation and tamper detection still apply.
 */
export function screenSource(source: string): string[] {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return FORBIDDEN_PATTERNS
    .filter(([pattern]) => pattern.test(withoutComments))
    .map(([, label]) => label);
}
