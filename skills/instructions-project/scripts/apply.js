#!/usr/bin/env node
// instructions-project: apply an approved plan. Scope: the repository's working
// tree, this project's Claude auto-memory dir, and the ~/.agent-instructions
// store. Home-level instruction files are outside the allowed roots and are
// refused before any write — that is what keeps this skill to its half.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { run, isMain, UsageError, table, fmtBytes } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { loadConfig, loadState, saveState, runDir } from './lib/config.js';
import { readJson } from './lib/fsx.js';
import { applyPlan, pruneBackups, ApplyError } from './lib/apply.js';
import { memoryDirFor } from './lib/memory.js';

const HELP = `usage: node apply.js --run <run-id> [--only <path,...>] [--replace-symlinks] [--dry-run] [--json]

Applies runs/<run-id>/plan.json (AGENTS.md → shim → copies → memory → moves),
one file at a time: backup → temp write → verify → atomic rename → manifest.
Never commits: the working tree changes, git does not.
Exit codes: 0 ok, 1 usage, 2 refused before any write, 3 stopped part-way.`;

export function allowedRoots(repoRoot, env = process.env) {
  return [repoRoot, memoryDirFor(repoRoot, env), storePaths(env).root];
}

async function main(flags) {
  if (!flags.run) throw new UsageError('--run is required');
  const env = process.env;
  const dir = runDir(flags.run, env);
  const planPath = join(dir, 'plan.json');
  if (!existsSync(planPath)) throw new UsageError(`no plan at ${planPath} — run render.js first`);
  const plan = readJson(planPath);
  if (plan.skill !== 'instructions-project') throw new UsageError(`plan belongs to ${plan.skill}, not instructions-project`);
  if (flags.only) {
    const wanted = new Set(flags.only);
    plan.actions = plan.actions.filter((a) => wanted.has(a.path) || wanted.has(tildify(a.path)));
  }
  const { config } = loadConfig(env);

  let manifest;
  try {
    manifest = applyPlan(plan, { allow: allowedRoots(plan.root, env), replaceSymlinks: !!flags['replace-symlinks'], dryRun: !!flags['dry-run'], env });
  } catch (error) {
    if (error instanceof ApplyError) {
      const m = error.data?.manifest;
      error.data = { manifest: m, applied: m?.entries.filter((e) => !e.failed).map((e) => e.path) ?? [], restore: `node scripts/restore.js --run ${flags.run}` };
      error.message = `${error.message}\nApplied so far: ${error.data.applied.length} file(s). Rollback (only if the user decides so): ${error.data.restore}`;
    }
    throw error;
  }

  let pruned = { pruned: [], kept: [], totalBytes: 0 };
  if (!flags['dry-run']) {
    // No per-target state for repositories (drift is read from the shim marker);
    // only the run itself is recorded so reports can compare runs.
    const state = loadState(env);
    state.runs.push({ runId: plan.runId, skill: plan.skill, root: plan.root, at: manifest.finishedAt, files: manifest.entries.length });
    saveState(state, env);
    pruned = pruneBackups(config.retention, env);
  }
  return {
    runId: plan.runId,
    status: manifest.status,
    entries: manifest.entries.map((e) => ({ file: e.path.startsWith(plan.root) ? e.path.slice(plan.root.length + 1) : tildify(e.path), action: e.action, before: e.before ? fmtBytes(e.before.size) : '-', after: e.after ? fmtBytes(e.after.size) : '-', verified: e.after?.sha256?.slice(0, 12) ?? '' })),
    backupDir: manifest.backupDir,
    restore: `node scripts/restore.js --run ${plan.runId}`,
    retention: { keep: config.retention, pruned: pruned.pruned, totalBytes: pruned.totalBytes }
  };
}

function render(r) {
  return [
    `run ${r.runId}: ${r.status}`,
    table([['file', 'file'], ['action', 'action'], ['before', 'before'], ['after', 'after'], ['verified', 'sha256']], r.entries),
    `backup: ${tildify(r.backupDir)} — restore with: ${r.restore}`,
    `retention: keeping ${r.retention.keep} runs (${fmtBytes(r.retention.totalBytes)} total)${r.retention.pruned.length ? `, pruned ${r.retention.pruned.join(', ')}` : ''}`
  ].join('\n');
}

if (isMain(import.meta.url)) {
  run({ spec: { run: 'string', only: 'list', 'replace-symlinks': 'bool', 'dry-run': 'bool' }, help: HELP, main, render });
}
