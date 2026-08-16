#!/usr/bin/env node
// Shared between ali-instructions-global and ali-instructions-project.
// After apply: collect, for every file the run changed, the pre-run version
// (from the backup) and the current version, plus a unified diff, into
// runs/<id>/review/ — the bundle an independent reviewer reads with a clean
// context. Read-only apart from that directory.

import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { run, isMain, UsageError, table } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { readJson, readText, atomicWrite, ensureDir, metricsOf } from './lib/fsx.js';
import { unifiedDiff, diffStats } from './lib/diff.js';

const HELP = `usage: node review.js --run <run-id> [--json]

Builds runs/<id>/review/: for each file the run wrote or moved,
<n>-<name>.before.md (from the backup, empty when created), <n>-<name>.after.md
(what is on disk now) and <n>-<name>.diff, plus README.md listing them with the
absolute target path and the metrics. Point the reviewer at that directory.`;

async function main(flags) {
  if (!flags.run) throw new UsageError('--run is required');
  const env = process.env;
  const store = storePaths(env);
  const manifestPath = join(store.backups, flags.run, 'manifest.json');
  if (!existsSync(manifestPath)) throw new UsageError(`no manifest for run ${flags.run} — nothing was applied yet`);
  const manifest = readJson(manifestPath);
  const dir = join(store.runs, flags.run, 'review');
  ensureDir(dir);
  const root = manifest.root ?? null;
  const label = (p) => (root && p.startsWith(root + '/') ? p.slice(root.length + 1) : tildify(p));

  const rows = [];
  let n = 0;
  for (const e of manifest.entries) {
    if (e.failed) continue;
    const before = e.backup && existsSync(e.backup) ? readText(e.backup).text : '';
    let after = '';
    if (e.action === 'move') after = existsSync(e.to) ? readText(e.to).text : '';
    else if (e.action !== 'remove' && existsSync(e.path)) after = readText(e.path).text;
    n++;
    const stem = `${String(n).padStart(2, '0')}-${basename(e.path).replace(/[^A-Za-z0-9._-]/g, '_')}`;
    atomicWrite(join(dir, `${stem}.before.md`), before);
    atomicWrite(join(dir, `${stem}.after.md`), after);
    atomicWrite(join(dir, `${stem}.diff`), unifiedDiff(before, after, { from: `${label(e.path)} (before)`, to: `${label(e.path)} (after)` }) || '(identical)\n');
    const b = metricsOf(before);
    const a = metricsOf(after);
    const d = diffStats(before, after);
    rows.push({ n, file: label(e.path), path: e.path, action: e.action + (e.to ? ` → ${tildify(e.to)}` : ''), stem, before: `${b.lines} l`, after: `${a.lines} l`, diff: `+${d.added} -${d.removed}` });
  }
  const readme = [
    `# Review bundle for run ${flags.run} (${manifest.skill})`,
    '',
    'Each entry: `<n>-<name>.before.md` = the file before the run (from the backup, empty when the file was created), `<n>-<name>.after.md` = the file now, `<n>-<name>.diff` = unified diff.',
    '',
    table([['n', '#'], ['file', 'file'], ['action', 'action'], ['before', 'before'], ['after', 'after'], ['diff', 'diff'], ['stem', 'files']], rows),
    ''
  ].join('\n');
  atomicWrite(join(dir, 'README.md'), readme);
  return { runId: flags.run, dir, files: rows.length, rows, readme: join(dir, 'README.md') };
}

if (isMain(import.meta.url)) {
  run({ spec: { run: 'string' }, help: HELP, main, render: (r) => `${r.files} file(s) → ${r.dir}\n${table([['n', '#'], ['file', 'file'], ['action', 'action'], ['before', 'before'], ['after', 'after'], ['diff', 'diff']], r.rows)}` });
}
