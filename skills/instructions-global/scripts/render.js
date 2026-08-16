#!/usr/bin/env node
// instructions-global: render the (proposed) master to every detected target,
// write the proposals and diffs into the run dir, and produce plan.json for
// apply.js. Writes only inside ~/.agent-instructions/runs/<run-id>/.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, isMain, UsageError, table, fmtBytes, fmtDelta } from './lib/cli.js';
import { storePaths, tildify, mirrorPath } from './lib/paths.js';
import { loadConfig, runDir } from './lib/config.js';
import { readText, atomicWrite, writeJson, metricsOf, ensureDir } from './lib/fsx.js';
import { detectSurfaces } from './lib/surfaces.js';
import { renderGlobal, GLOBAL_TARGETS, stripRenderedHead } from './lib/render.js';
import { parseGeneratedMarker } from './lib/markers.js';
import { unifiedDiff, diffStats } from './lib/diff.js';
import { settingsFiles, readSettings } from './lib/vscode.js';

const HELP = `usage: node render.js --run <run-id> [options]

Renders the master (or --master-from <file>, the proposed v-next) to every
detected surface, writes runs/<id>/proposal/<target>.md and diff/<target>.diff,
and writes runs/<id>/plan.json for apply.js.

  --run <id>               run id from inventory.js --new-run
  --master-from <file>     proposed master text (default: the current master)
  --targets <a,b>          restrict to surface ids (claude,codex,copilot-cli,jetbrains)
  --include-undetected     also render for surfaces whose config dir is missing
  --vscode                 propose settings edits for every VS Code settings file found
  --vscode-settings <p,q>  ...or only for these settings.json files
  --archive <p,q>          files to move into ~/.agent-instructions/archive/<run-id>/ (legacy channels, memory)
  --json`;

const VSCODE_TARGET = { 'chat.useClaudeMdFile': false };

async function main(flags) {
  if (!flags.run) throw new UsageError('--run is required');
  const env = process.env;
  const store = storePaths(env);
  const { config } = loadConfig(env);
  const dir = runDir(flags.run, env);
  const proposalDir = join(dir, 'proposal');
  const diffDir = join(dir, 'diff');
  ensureDir(proposalDir);
  ensureDir(diffDir);

  const masterSource = flags['master-from'] ?? store.master;
  if (!existsSync(masterSource)) throw new UsageError(`master not found: ${masterSource} (pass --master-from with the proposed text)`);
  const masterText = readText(masterSource).text;
  const masterLabel = tildify(store.master);

  const actions = [];
  const rows = [];

  // 1. master itself (only when the proposal differs from what is on disk)
  const currentMaster = existsSync(store.master) ? readText(store.master).text : '';
  if (currentMaster !== masterText) {
    const p = join(proposalDir, 'global.md');
    atomicWrite(p, masterText);
    atomicWrite(join(diffDir, 'global.md.diff'), unifiedDiff(currentMaster, masterText, { from: masterLabel, to: 'proposal' }));
    actions.push({ action: 'write', path: store.master, from: p, target: 'master' });
    rows.push(row('master', store.master, currentMaster, masterText));
  }

  // 2. targets
  const only = flags.targets;
  const all = detectSurfaces(env, { disabled: config.disabled_surfaces }).filter((s) => s.target && GLOBAL_TARGETS[s.id]);
  const surfaces = all.filter((s) => (!only || only.includes(s.id)) && !s.disabled && (s.detected || flags['include-undetected']));
  const skipped = all
    .filter((s) => !surfaces.includes(s))
    .map((s) => ({ id: s.id, reason: s.disabled ? 'disabled in config' : !s.detected ? `not detected (${tildify(s.configDir)} missing)` : 'not in --targets' }));
  for (const s of surfaces) {
    const { text, hash, body } = renderGlobal(masterText, { target: s.id, runId: flags.run, masterLabel });
    const current = s.file.exists ? readText(s.target).text : '';
    const p = join(proposalDir, `${s.id}.md`);
    atomicWrite(p, text);
    atomicWrite(join(diffDir, `${s.id}.diff`), unifiedDiff(current, text, { from: tildify(s.target), to: 'proposal' }));
    // Idempotent: same body under an older run's marker is "unchanged" — the marker alone is no reason to rewrite.
    const same = current === text || (parseGeneratedMarker(current)?.hash === hash && stripRenderedHead(current) === body);
    if (same) {
      rows.push({ ...row(s.id, s.target, current, text), status: 'unchanged' });
      continue;
    }
    actions.push({ action: 'write', path: s.target, from: p, target: s.id });
    rows.push({ ...row(s.id, s.target, current, text), status: s.file.exists ? 'overwrite' : 'create' });
  }

  // 3. VS Code settings
  const settingsTargets = flags['vscode-settings'] ?? (flags.vscode ? settingsFiles(env).filter((f) => f.scope === 'user').map((f) => f.path) : []);
  for (const path of settingsTargets) {
    const current = readSettings(path);
    const set = {};
    for (const [key, value] of Object.entries(VSCODE_TARGET)) if (current.values[key] !== value) set[key] = value;
    const locations = { ...(current.values['chat.instructionsFilesLocations'] ?? {}) };
    if (locations['~/.copilot/instructions'] !== true) set['chat.instructionsFilesLocations'] = { ...locations, '~/.copilot/instructions': true };
    if (Object.keys(set).length) {
      actions.push({ action: 'settings', path, set, target: 'vscode' });
      rows.push({ target: 'vscode settings', file: tildify(path), status: current.exists ? 'edit' : 'create', keys: Object.keys(set).join(', ') });
    }
  }

  // 4. archive (legacy channels, superseded memory files) — moves, never removals
  for (const p of flags.archive ?? []) {
    if (!existsSync(p)) throw new UsageError(`--archive: ${p} does not exist`);
    const to = mirrorPath(join(store.root, 'archive', flags.run), p);
    actions.push({ action: 'move', path: p, to, target: 'archive' });
    rows.push({ target: 'archive', file: tildify(p), status: `move → ${tildify(to)}` });
  }

  const plan = { runId: flags.run, skill: 'instructions-global', createdAt: new Date().toISOString(), master: { from: masterSource }, actions };
  writeJson(join(dir, 'plan.json'), plan);
  const codexTarget = surfaces.find((s) => s.id === 'codex')?.target;
  writeJson(join(dir, 'render.json'), {
    rows,
    skipped,
    thresholdChecks: codexTarget ? [{ label: 'Codex global file', path: codexTarget, limit: config.thresholds.codex_budget_bytes, kind: 'bytes' }] : []
  });

  const warnings = [];
  const m = metricsOf(masterText);
  if (m.lines > config.thresholds.master_lines) warnings.push(`master would have ${m.lines} lines (soft limit ${config.thresholds.master_lines})`);
  const codexRow = rows.find((r) => r.target === 'codex');
  if (codexRow && codexRow.afterBytes > config.thresholds.codex_budget_bytes) warnings.push(`Codex global file would be ${fmtBytes(codexRow.afterBytes)} — early warning before the ${fmtBytes(config.thresholds.codex_cap_bytes)} cap`);

  return { runId: flags.run, plan: join(dir, 'plan.json'), proposalDir, diffDir, actions: actions.length, rows, skipped, warnings };
}

function row(target, path, before, after) {
  const b = metricsOf(before);
  const a = metricsOf(after);
  const d = diffStats(before, after);
  return {
    target,
    file: tildify(path),
    before: before ? `${b.lines} l / ${fmtBytes(b.bytes)} / ~${b.tokens} t` : '(absent)',
    after: `${a.lines} l / ${fmtBytes(a.bytes)} / ~${a.tokens} t`,
    delta: fmtDelta(b.bytes, a.bytes),
    diff: `+${d.added} -${d.removed}`,
    afterBytes: a.bytes
  };
}

function render(r) {
  const out = [`run ${r.runId}: ${r.actions} action(s) → ${r.plan}`];
  out.push(table([['target', 'target'], ['file', 'file'], ['before', 'before'], ['after', 'after'], ['delta', 'delta'], ['diff', 'diff'], ['status', 'status'], ['keys', 'keys']], r.rows));
  for (const s of r.skipped) out.push(`skipped ${s.id}: ${s.reason}`);
  for (const w of r.warnings) out.push(`warning: ${w}`);
  out.push(`proposals: ${r.proposalDir}`, `diffs: ${r.diffDir}`);
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  run({
    spec: { run: 'string', 'master-from': 'string', targets: 'list', 'include-undetected': 'bool', vscode: 'bool', 'vscode-settings': 'list', archive: 'list' },
    help: HELP,
    main,
    render
  });
}
