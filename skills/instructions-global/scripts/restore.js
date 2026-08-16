#!/usr/bin/env node
// Shared between ali-instructions-global and ali-instructions-project.
// Roll a run back from its backup manifest. Works without the model.

import { run, isMain, UsageError, table } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { readJson } from './lib/fsx.js';
import { restoreRun, listRuns } from './lib/apply.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const HELP = `usage: node restore.js --list
       node restore.js --run <run-id> [--path <file>] [--dry-run] [--json]

  --list           show the backed-up runs (newest last)
  --run <id>       restore every file of that run to its pre-run state (last entry first)
  --path <file>    restore only this file from that run
  --dry-run        print what would be restored, change nothing
Backups live in ~/.agent-instructions/backups/<run-id>/ (mirrored absolute paths + manifest.json).`;

async function main(flags) {
  if (flags.list) return { runs: listRuns() };
  if (!flags.run) throw new UsageError('pass --list or --run <id>');
  const manifestPath = join(storePaths().backups, flags.run, 'manifest.json');
  if (!existsSync(manifestPath)) throw new UsageError(`no manifest for run ${flags.run} (${manifestPath})`);
  const manifest = readJson(manifestPath);
  const restored = restoreRun(manifest, { only: flags.path, dryRun: !!flags['dry-run'] });
  return { runId: flags.run, dryRun: !!flags['dry-run'], restored: restored.map((r) => ({ ...r, file: tildify(r.path) })) };
}

function render(r) {
  if (r.runs) {
    if (!r.runs.length) return 'no backed-up runs';
    return table([['runId', 'run'], ['skill', 'skill'], ['status', 'status'], ['startedAt', 'started'], ['files', 'files']], r.runs);
  }
  const head = r.dryRun ? `dry-run: run ${r.runId} would restore` : `run ${r.runId}: restored`;
  return [head, table([['file', 'file'], ['action', 'undone action']], r.restored)].join('\n');
}

if (isMain(import.meta.url)) {
  run({ spec: { list: 'bool', run: 'string', path: 'string', 'dry-run': 'bool' }, help: HELP, main, render });
}
