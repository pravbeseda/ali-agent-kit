#!/usr/bin/env node
// Shared between ali-instructions-global and ali-instructions-project.
// Exact and near-duplicate rule lines across the given files, plus lines that
// look like secrets. Hints for the rubric pass — the model decides the labels.

import { run, isMain, UsageError, table } from './lib/cli.js';
import { readText } from './lib/fsx.js';
import { tildify } from './lib/paths.js';
import { ruleLines, findDuplicates, findSecrets } from './lib/dupes.js';

const HELP = `usage: node dupes.js [--threshold 0.7] [--json] <file> [<file>...]

Splits each markdown file into rule lines (list items and paragraphs; headings,
fences and comments skipped), then reports exact duplicates (after
normalisation), near duplicates (Dice similarity over tokens >= threshold), and
secret-looking lines. Line numbers are 1-based in the original file.`;

async function main(flags, files) {
  if (!files.length) throw new UsageError('pass at least one file');
  const lines = files.flatMap((f) => ruleLines(readText(f).text, f));
  const { exact, near } = findDuplicates(lines, { threshold: Number(flags.threshold) || 0.7 });
  const secrets = findSecrets(lines);
  const strip = (l) => ({ file: tildify(l.file), line: l.line, section: l.section, text: l.text });
  return {
    files: files.length,
    lines: lines.length,
    exact: exact.map((g) => g.map(strip)),
    near: near.map((p) => ({ a: strip(p.a), b: strip(p.b), score: p.score })),
    secrets: secrets.map(strip)
  };
}

function render(r) {
  const out = [`${r.files} file(s), ${r.lines} rule line(s)`, ''];
  out.push(`exact duplicate groups: ${r.exact.length}`);
  r.exact.forEach((g, i) => {
    out.push(`  [${i + 1}] "${g[0].text}"`);
    for (const l of g) out.push(`      ${l.file}:${l.line} (${l.section || 'no section'})`);
  });
  out.push('', `near duplicates: ${r.near.length}`);
  if (r.near.length) out.push(table([['score', 'score'], ['a', 'a'], ['b', 'b']], r.near.map((p) => ({ score: p.score, a: `${p.a.file}:${p.a.line} ${p.a.text}`, b: `${p.b.file}:${p.b.line} ${p.b.text}` }))));
  out.push('', `secret-looking lines: ${r.secrets.length}`);
  for (const s of r.secrets) out.push(`  ${s.file}:${s.line}`);
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  run({ spec: { threshold: 'string' }, help: HELP, main, render });
}
