#!/usr/bin/env node
// Shared between ali-instructions-global and ali-instructions-project.
// Deterministic report tables for a run: file metrics before → after (from the
// backup manifest and the files on disk), label counts and listings (from the
// model-written labels.json), sync status (from render.json), backup line.
// The model writes the narrative around these tables; it never invents numbers.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, isMain, UsageError, table, fmtBytes, fmtDelta } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { loadConfig, loadState } from './lib/config.js';
import { readJson, readText, metricsOf, atomicWrite } from './lib/fsx.js';

const HELP = `usage: node report.js --run <run-id> [--write] [--json]

Reads runs/<id>/{inventory.json,plan.json,render.json,labels.json} and
backups/<id>/manifest.json (whatever exists) and prints the report tables.
  --write   also save them as runs/<id>/report-tables.md
labels.json (written by the model): { "entries": [ { "file", "line", "text",
  "label": "KEEP|REWORD|MERGE|MOVE|DROP:<code>|FLAG", "reason", "to", "after", "batch" } ] }`;

const LABELS = ['KEEP', 'REWORD', 'MERGE', 'MOVE', 'DROP:DUP', 'DROP:KARPATHY', 'DROP:VAGUE', 'DROP:STALE', 'DROP:SECRET', 'DROP:DEFAULT', 'FLAG'];

async function main(flags) {
  if (!flags.run) throw new UsageError('--run is required');
  const env = process.env;
  const store = storePaths(env);
  const dir = join(store.runs, flags.run);
  if (!existsSync(dir)) throw new UsageError(`no run dir ${dir}`);
  const { config } = loadConfig(env);
  const state = loadState(env);
  const manifestPath = join(store.backups, flags.run, 'manifest.json');
  const manifest = existsSync(manifestPath) ? readJson(manifestPath) : null;
  const plan = existsSync(join(dir, 'plan.json')) ? readJson(join(dir, 'plan.json')) : null;
  const renderInfo = existsSync(join(dir, 'render.json')) ? readJson(join(dir, 'render.json')) : null;
  const labels = existsSync(join(dir, 'labels.json')) ? readJson(join(dir, 'labels.json')).entries ?? [] : [];

  const root = plan?.root ?? manifest?.root ?? null;
  const short = (p) => (root && p.startsWith(root + '/') ? p.slice(root.length + 1) : tildify(p));
  const sections = [];

  // Files before → after
  const fileRows = [];
  const source = manifest ? manifest.entries : plan ? plan.actions : [];
  for (const e of source) {
    const path = e.path;
    const beforeText = manifest ? (e.backup && existsSync(e.backup) ? readText(e.backup).text : '') : existsSync(path) ? readText(path).text : '';
    let afterText = '';
    if (manifest) afterText = e.action === 'remove' ? '' : existsSync(e.to ?? path) ? readText(e.to ?? path).text : '';
    else if (e.action === 'write') afterText = readText(e.from).text;
    else if (e.action === 'move' || e.action === 'remove') afterText = '';
    else afterText = beforeText;
    const b = metricsOf(beforeText);
    const a = metricsOf(afterText);
    fileRows.push({
      file: short(path),
      action: e.action + (e.to ? ` → ${tildify(e.to)}` : ''),
      before: beforeText ? `${b.lines} l / ${fmtBytes(b.bytes)} / ~${b.tokens} t` : '-',
      after: afterText ? `${a.lines} l / ${fmtBytes(a.bytes)} / ~${a.tokens} t` : '-',
      delta: fmtDelta(b.bytes, a.bytes),
      status: e.failed ? `FAILED: ${e.failed}` : manifest ? 'applied' : 'proposed'
    });
  }
  sections.push({ title: `Files (${manifest ? 'applied' : 'proposed'}; tokens = chars/4)`, body: fileRows.length ? table([['file', 'file'], ['action', 'action'], ['before', 'before'], ['after', 'after'], ['delta', 'delta'], ['status', 'status']], fileRows) : '_no file changes_' });

  // Labels
  if (labels.length) {
    const counts = {};
    for (const l of LABELS) counts[l] = 0;
    for (const e of labels) counts[e.label] = (counts[e.label] ?? 0) + 1;
    sections.push({ title: 'Labels', body: table([['label', 'label'], ['count', 'count']], Object.entries(counts).filter(([, n]) => n).map(([label, count]) => ({ label, count }))) });
    const rewords = labels.filter((e) => e.label === 'REWORD');
    if (rewords.length) sections.push({ title: 'REWORD (before → after) — proofread these', body: table([['file', 'file'], ['line', 'line'], ['text', 'before'], ['after', 'after']], rewords) });
    const moves = labels.filter((e) => e.label === 'MOVE');
    if (moves.length) sections.push({ title: 'MOVE (from → to)', body: table([['file', 'from'], ['line', 'line'], ['text', 'text'], ['to', 'to']], moves) });
    const merges = labels.filter((e) => e.label === 'MERGE');
    if (merges.length) sections.push({ title: 'MERGE (→ surviving line)', body: table([['file', 'file'], ['line', 'line'], ['text', 'text'], ['to', 'surviving line']], merges) });
    const drops = labels.filter((e) => e.label.startsWith('DROP:'));
    if (drops.length) sections.push({ title: 'DROP (with evidence)', body: table([['label', 'code'], ['file', 'file'], ['line', 'line'], ['text', 'text'], ['reason', 'evidence']], drops) });
    const flags_ = labels.filter((e) => e.label === 'FLAG');
    if (flags_.length) sections.push({ title: 'FLAG (needs the user)', body: table([['batch', 'batch'], ['file', 'file'], ['line', 'line'], ['text', 'text'], ['reason', 'question']], flags_) });
  }

  // Sync status
  if (renderInfo) {
    const rows = [
      ...renderInfo.rows.map((r) => ({ target: r.target, file: r.file, status: r.status ?? 'proposed', note: r.keys ?? '' })),
      ...renderInfo.skipped.map((s) => ({ target: s.id, file: '-', status: 'skipped', note: s.reason }))
    ];
    sections.push({ title: 'Sync status per surface', body: table([['target', 'surface'], ['file', 'file'], ['status', 'status'], ['note', 'note']], rows) });
  }

  // Thresholds
  const warnings = [];
  const check = (label, path, limit, kind) => {
    if (!path || !existsSync(path)) return;
    const m = metricsOf(readText(path).text);
    const value = kind === 'lines' ? m.lines : m.bytes;
    if (value > limit) warnings.push(`${label}: ${kind === 'lines' ? `${value} lines` : fmtBytes(value)} exceeds the soft limit ${kind === 'lines' ? limit : fmtBytes(limit)}`);
  };
  check('master', store.master, config.thresholds.master_lines, 'lines');
  if (renderInfo?.thresholdChecks) for (const c of renderInfo.thresholdChecks) check(c.label, c.path, c.limit, c.kind);
  if (warnings.length) sections.push({ title: 'Threshold warnings', body: warnings.map((w) => `- ${w}`).join('\n') });

  // Backup + previous run
  const prev = state.runs.filter((r) => r.runId !== flags.run).at(-1);
  const backupLine = manifest
    ? `Backup: ${tildify(manifest.backupDir)} (${manifest.entries.length} entries, status ${manifest.status}). Restore: \`node scripts/restore.js --run ${flags.run}\`.`
    : 'Backup: none yet (nothing applied).';
  sections.push({ title: 'Backup', body: `${backupLine}${prev ? `\nPrevious run: ${prev.runId} (${prev.at})` : ''}` });

  const markdown = sections.map((s) => `### ${s.title}\n\n${s.body}`).join('\n\n') + '\n';
  const out = { runId: flags.run, markdown, warnings, files: fileRows.length, labels: labels.length };
  if (flags.write) {
    const p = join(dir, 'report-tables.md');
    atomicWrite(p, markdown);
    out.written = p;
  }
  return out;
}

if (isMain(import.meta.url)) {
  run({ spec: { run: 'string', write: 'bool' }, help: HELP, main, render: (r) => r.markdown + (r.written ? `\nwritten ${r.written}` : '') });
}
