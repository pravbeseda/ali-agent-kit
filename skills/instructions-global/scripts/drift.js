#!/usr/bin/env node
// instructions-global: drift between the last applied run (state.json) and what
// is on disk now — in both directions: hand-edited targets and an edited master.

import { existsSync } from 'node:fs';
import { run, isMain, table, EXIT } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { loadState, loadConfig } from './lib/config.js';
import { readText, sha256 } from './lib/fsx.js';
import { detectSurfaces } from './lib/surfaces.js';
import { renderGlobal, GLOBAL_TARGETS, stripRenderedHead } from './lib/render.js';
import { unifiedDiff } from './lib/diff.js';
import { parseGeneratedMarker, contentHash } from './lib/markers.js';

const HELP = `usage: node drift.js [--diff] [--check] [--json]

Compares every target's current content with the hash recorded by the last
apply (state.json) and with a fresh render of the current master.
  unchanged      target equals what the last run wrote and the master still renders to it
  master-moved   master edited since the last run → re-render (--sync-only)
  hand-edited    target edited by hand → merge into the master or overwrite
  both           both moved → show both diffs, ask
  missing        target file gone
  never-applied  no record in state.json for this target
  --diff   include unified diffs (target vs render of the current master)
  --check  exit 2 when anything drifted (for use as a verification step)
On a first run every target is "never-applied" — that is the expected state, not a problem.`;

export function driftReport({ env = process.env, withDiff = false } = {}) {
  const store = storePaths(env);
  const state = loadState(env);
  const { config } = loadConfig(env);
  const master = existsSync(store.master) ? readText(store.master).text : null;
  const masterHash = master === null ? null : contentHash(master);
  const masterState = state.master ? (state.master.hash === masterHash ? 'unchanged' : 'edited since last run') : 'never applied';

  const rows = [];
  for (const s of detectSurfaces(env, { disabled: config.disabled_surfaces })) {
    if (!s.target || !GLOBAL_TARGETS[s.id]) continue;
    const recorded = state.targets[s.target];
    const row = { surface: s.id, file: tildify(s.target), recorded: recorded?.runId ?? null, state: null, diff: null };
    if (!s.detected && !recorded) continue;
    if (!s.file.exists) {
      row.state = recorded ? 'missing' : 'never-applied';
      rows.push(row);
      continue;
    }
    const current = readText(s.target).text;
    const currentHash = sha256(current);
    const marker = parseGeneratedMarker(current);
    const rendered = master === null ? null : renderGlobal(master, { target: s.id, runId: recorded?.runId ?? 'x', masterLabel: tildify(store.master) });
    const bodyNow = stripRenderedHead(current);
    const bodyRendered = rendered ? rendered.body : null;
    // hand edit: the file differs from what we wrote (state hash, else its own marker hash)
    const handEdited = recorded ? currentHash !== recorded.sha256 : marker ? contentHash(bodyNow) !== marker.hash : true;
    // master moved: the master now renders to something else than the marker recorded
    const masterMoved = rendered !== null && marker ? rendered.hash !== marker.hash : rendered !== null && bodyNow !== bodyRendered;
    if (!recorded && !marker) row.state = 'never-applied';
    else if (handEdited && masterMoved) row.state = 'both';
    else if (handEdited) row.state = 'hand-edited';
    else if (masterMoved) row.state = 'master-moved';
    else row.state = 'unchanged';
    if (withDiff && rendered && row.state !== 'unchanged') {
      row.diff = unifiedDiff(bodyNow, bodyRendered, { from: `${tildify(s.target)} (body)`, to: 'render of current master' });
    }
    rows.push(row);
  }
  const firstRun = !state.runs.length && rows.every((r) => r.state === 'never-applied');
  const anyChange = !firstRun && (masterState !== 'unchanged' || rows.some((r) => r.state !== 'unchanged'));
  return { master: { path: tildify(store.master), exists: master !== null, state: masterState }, targets: rows, anyChange, lastRun: state.runs.at(-1) ?? null };
}

function render(r) {
  const out = [`master ${r.master.path}: ${r.master.exists ? r.master.state : 'absent'}`, `last run: ${r.lastRun?.runId ?? 'none'}`, ''];
  out.push(table([['surface', 'surface'], ['file', 'file'], ['recorded', 'recorded run'], ['state', 'state']], r.targets));
  for (const t of r.targets) if (t.diff) out.push('', t.diff);
  const firstRun = !r.lastRun && r.targets.every((t) => t.state === 'never-applied');
  out.push('', firstRun ? 'first run — nothing applied yet (expected)' : r.anyChange ? 'drift detected' : 'no changes');
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  run({
    spec: { diff: 'bool', check: 'bool' },
    help: HELP,
    main: (flags) => {
      const r = driftReport({ withDiff: !!flags.diff });
      return flags.check && r.anyChange ? { ...r, exitCode: EXIT.ERROR } : r;
    },
    render
  });
}
