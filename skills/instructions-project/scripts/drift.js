#!/usr/bin/env node
// instructions-project: drift from the marker hashes only — no state file lives
// in a repository. The shim and the Copilot copy each carry the AGENTS.md hash
// they were rendered from; compare with the AGENTS.md on disk now.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, isMain, table, EXIT } from './lib/cli.js';
import { readText } from './lib/fsx.js';
import { parseShimMarker, parseGeneratedMarker, contentHash } from './lib/markers.js';
import { renderShim, renderCopilotCopy, shimImportState, shimTail } from './lib/render.js';
import { unifiedDiff } from './lib/diff.js';
import { classify } from './gate.js';

const HELP = `usage: node drift.js [--dir <repo>] [--diff] [--check] [--json]

  in-sync        marker hash equals the current AGENTS.md
  agents-moved   AGENTS.md edited after the shim/copy was rendered → re-render (--sync-only)
  hand-edited    the generated file itself was edited (body differs from a fresh render) → merge or overwrite
  not-generated  file exists without our marker
  absent         file missing (not drift)
  --check  exit 2 when drift is detected (for use as a verification step)`;

export function projectDrift({ dir = process.cwd(), withDiff = false } = {}) {
  const root = classify(dir).root;
  const agentsPath = join(root, 'AGENTS.md');
  const agents = existsSync(agentsPath) ? readText(agentsPath).text : null;
  const hash = agents === null ? null : contentHash(agents);
  const rows = [];

  const shimPath = join(root, '.claude', 'CLAUDE.md');
  if (!existsSync(shimPath)) rows.push({ file: '.claude/CLAUDE.md', state: 'absent' });
  else {
    const text = readText(shimPath).text;
    const marker = parseShimMarker(text);
    if (!marker) rows.push({ file: '.claude/CLAUDE.md', state: 'not-generated' });
    else if (agents === null) rows.push({ file: '.claude/CLAUDE.md', state: 'orphan (AGENTS.md missing)' });
    else {
      // Claude-only content after the import is legitimate; a hand edit means the marker line or import changed.
      const importState = shimImportState(text);
      const structural = importState === 'current' && text.trimStart().startsWith('<!-- instructions-project: shim');
      const state = importState === 'stale' ? 'stale-import' : marker.hash !== hash ? 'agents-moved' : structural ? 'in-sync' : 'hand-edited';
      const row = { file: '.claude/CLAUDE.md', state, recordedHash: marker.hash.slice(0, 12), agentsHash: hash.slice(0, 12) };
      if (withDiff && state !== 'in-sync') row.diff = unifiedDiff(text, renderShim(agents, { claudeOnly: shimTail(text) }).text, { from: '.claude/CLAUDE.md', to: 'fresh shim' });
      rows.push(row);
    }
  }

  const copyPath = join(root, '.github', 'copilot-instructions.md');
  if (existsSync(copyPath)) {
    const text = readText(copyPath).text;
    const marker = parseGeneratedMarker(text);
    if (!marker) rows.push({ file: '.github/copilot-instructions.md', state: 'not-generated (hand-written)' });
    else if (agents === null) rows.push({ file: '.github/copilot-instructions.md', state: 'orphan (AGENTS.md missing)' });
    else {
      const fresh = renderCopilotCopy(agents, { runId: marker.runId });
      const bodyNow = text.replace(/^<!--[\s\S]*?-->\r?\n(\r?\n)?/, '');
      const state = marker.hash !== hash ? (contentHash(bodyNow) === marker.hash ? 'agents-moved' : 'both') : contentHash(bodyNow) === marker.hash ? 'in-sync' : 'hand-edited';
      const row = { file: '.github/copilot-instructions.md', state, recordedHash: marker.hash.slice(0, 12), agentsHash: hash.slice(0, 12) };
      if (withDiff && state !== 'in-sync') row.diff = unifiedDiff(text, fresh.text, { from: '.github/copilot-instructions.md', to: 'fresh copy' });
      rows.push(row);
    }
  }
  // "absent" and a hand-written (never generated) file are states to report, not drift
  const DRIFT = ['agents-moved', 'hand-edited', 'both', 'stale-import'];
  const anyChange = rows.some((r) => DRIFT.includes(r.state) || r.state.startsWith('orphan'));
  return { root, agentsExists: agents !== null, agentsHash: hash?.slice(0, 12) ?? null, files: rows, anyChange };
}

function render(r) {
  const out = [`${r.root}: AGENTS.md ${r.agentsExists ? `hash ${r.agentsHash}` : 'absent'}`, table([['file', 'file'], ['state', 'state'], ['recordedHash', 'marker hash'], ['agentsHash', 'AGENTS.md hash']], r.files)];
  for (const f of r.files) if (f.diff) out.push('', f.diff);
  out.push(r.anyChange ? 'drift detected' : 'no changes');
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  run({
    spec: { dir: 'string', diff: 'bool', check: 'bool' },
    help: HELP,
    main: (flags) => {
      const r = projectDrift({ dir: flags.dir, withDiff: !!flags.diff });
      return flags.check && r.anyChange ? { ...r, exitCode: EXIT.ERROR } : r;
    },
    render
  });
}
