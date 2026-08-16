// Shared between ali-instructions-global and ali-instructions-project.
// Small unified diff (LCS over lines) — instruction files are short, so an
// O(n*m) table is fine and we avoid depending on git or diff being on PATH.

export function diffLines(a, b) {
  const x = a.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const y = b.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  if (a === '') x.length = 0;
  if (b === '') y.length = 0;
  const n = x.length;
  const m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      ops.push({ t: ' ', line: x[i], i, j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ t: '-', line: x[i], i, j });
      i++;
    } else {
      ops.push({ t: '+', line: y[j], i, j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ t: '-', line: x[i], i, j });
    i++;
  }
  while (j < m) {
    ops.push({ t: '+', line: y[j], i, j });
    j++;
  }
  return ops;
}

/** Unified diff text with `context` lines; empty string when identical. */
export function unifiedDiff(a, b, { from = 'a', to = 'b', context = 3 } = {}) {
  const ops = diffLines(a, b);
  if (!ops.some((o) => o.t !== ' ')) return '';
  // Group changes whose gap is <= 2*context into one hunk (like diff(1)), so
  // no context line is ever printed twice.
  const changes = ops.map((o, i) => (o.t !== ' ' ? i : -1)).filter((i) => i >= 0);
  const hunks = [];
  let g = 0;
  while (g < changes.length) {
    let first = changes[g];
    let last = first;
    while (g + 1 < changes.length && changes[g + 1] - last <= 2 * context + 1) last = changes[++g];
    g++;
    hunks.push(ops.slice(Math.max(0, first - context), Math.min(ops.length, last + context + 1)));
  }
  const out = [`--- ${from}`, `+++ ${to}`];
  for (const h of hunks) {
    const aLen = h.filter((o) => o.t !== '+').length;
    const bLen = h.filter((o) => o.t !== '-').length;
    // an empty side is written as "-0,0" / "+0,0", like diff(1) does
    const aStart = aLen ? h.find((o) => o.t !== '+').i + 1 : h[0].i;
    const bStart = bLen ? h.find((o) => o.t !== '-').j + 1 : h[0].j;
    out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
    for (const o of h) out.push(`${o.t}${o.line}`);
  }
  return out.join('\n') + '\n';
}

export function diffStats(a, b) {
  const ops = diffLines(a, b);
  return { added: ops.filter((o) => o.t === '+').length, removed: ops.filter((o) => o.t === '-').length };
}
