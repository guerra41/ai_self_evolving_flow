type Op = { type: ' ' | '-' | '+'; text: string };

// Above this many cells the line-level LCS table is skipped and the whole file is
// reported as replaced, which is still a correct (if coarse) diff.
const MAX_TABLE_CELLS = 4_000_000;

function diffOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;

  if ((n + 1) * (m + 1) > MAX_TABLE_CELLS) {
    return [
      ...a.map((text): Op => ({ type: '-', text })),
      ...b.map((text): Op => ({ type: '+', text })),
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = a[i] === b[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ type: '-', text: a[i] });
      i += 1;
    } else {
      ops.push({ type: '+', text: b[j] });
      j += 1;
    }
  }
  for (; i < n; i += 1) ops.push({ type: '-', text: a[i] });
  for (; j < m; j += 1) ops.push({ type: '+', text: b[j] });
  return ops;
}

/** Unified diff of two texts with `context` unchanged lines around each change. */
export function unifiedDiff(before: string, after: string, context = 3): string {
  // Line endings are not a change: a CRLF working file and an LF proposal must not look
  // like a rewrite of every line.
  const left = before.replace(/\r\n/g, '\n');
  const right = after.replace(/\r\n/g, '\n');
  if (left === right) {
    return '--- no source change ---';
  }

  const ops = diffOps(left.split('\n'), right.split('\n'));

  // Merge the windows around every change into hunks.
  const ranges: Array<[number, number]> = [];
  ops.forEach((op, index) => {
    if (op.type === ' ') {
      return;
    }
    const start = Math.max(0, index - context);
    const end = Math.min(ops.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  });

  const out = ['--- before', '+++ after'];
  for (const [start, end] of ranges) {
    const slice = ops.slice(start, end + 1);
    const oldBefore = ops.slice(0, start).filter((op) => op.type !== '+').length;
    const newBefore = ops.slice(0, start).filter((op) => op.type !== '-').length;
    const oldCount = slice.filter((op) => op.type !== '+').length;
    const newCount = slice.filter((op) => op.type !== '-').length;
    out.push(`@@ -${oldBefore + 1},${oldCount} +${newBefore + 1},${newCount} @@`);
    out.push(...slice.map((op) => `${op.type}${op.text}`));
  }
  return out.join('\n');
}
