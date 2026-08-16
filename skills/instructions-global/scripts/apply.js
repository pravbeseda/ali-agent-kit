#!/usr/bin/env node
// instructions-global: apply an approved plan. Scope: home-level agent files,
// VS Code user settings, the ~/.agent-instructions store and Claude auto-memory
// dirs. Anything else — a repository in particular — is refused before any write.

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { run, isMain, UsageError, table, fmtBytes } from './lib/cli.js';
import { storePaths, agentDirs, jetbrainsCopilotDir, vscodeUserDirs, tildify } from './lib/paths.js';
import { loadConfig, loadState, saveState, runDir } from './lib/config.js';
import { readJson, readText } from './lib/fsx.js';
import { applyPlan, pruneBackups, ApplyError } from './lib/apply.js';
import { contentHash } from './lib/markers.js';

const HELP = `usage: node apply.js --run <run-id> [--only <path,...>] [--replace-symlinks] [--dry-run] [--json]

Applies runs/<run-id>/plan.json in order (master → targets → settings → moves),
one file at a time: backup → temp write → verify → atomic rename → manifest.
Stops at the first failure and prints the restore command. Then records the
result in state.json and prunes backups beyond the retention.

  --only <paths>       apply a subset (the user approved only these files)
  --replace-symlinks   allow replacing a symlink at a target path
  --dry-run            validate and report, write nothing
Exit codes: 0 ok, 1 usage, 2 refused before any write, 3 stopped part-way.`;

export function allowedRoots(env = process.env) {
  const dirs = agentDirs(env);
  return [storePaths(env).root, dirs.claude, dirs.codex, dirs.copilot, jetbrainsCopilotDir(env), ...vscodeUserDirs(env).map((v) => v.dir)];
}

async function main(flags) {
  if (!flags.run) throw new UsageError('--run is required');
  const env = process.env;
  const dir = runDir(flags.run, env);
  const planPath = join(dir, 'plan.json');
  if (!existsSync(planPath)) throw new UsageError(`no plan at ${planPath} — run render.js first`);
  const plan = readJson(planPath);
  if (plan.skill !== 'instructions-global') throw new UsageError(`plan belongs to ${plan.skill}, not instructions-global`);
  if (flags.only) {
    const wanted = new Set(flags.only);
    const chosen = plan.actions.filter((a) => wanted.has(a.path) || wanted.has(tildify(a.path)));
    // Rendered targets carry the hash of the proposed master; applying them without
    // the master leaves drift.js pointing at a master that never landed.
    const masterInPlan = plan.actions.some((a) => a.target === 'master');
    const masterChosen = chosen.some((a) => a.target === 'master');
    if (masterInPlan && !masterChosen && chosen.some((a) => a.target !== 'master')) {
      throw new UsageError('--only: the plan changes the master, so a subset must include it (or select only the master and run --sync-only later)');
    }
    plan.actions = chosen;
  }
  const { config } = loadConfig(env);
  const store = storePaths(env);

  let manifest;
  try {
    manifest = applyPlan(plan, { allow: allowedRoots(env), replaceSymlinks: !!flags['replace-symlinks'], dryRun: !!flags['dry-run'], env });
  } catch (error) {
    if (error instanceof ApplyError) {
      const m = error.data?.manifest;
      error.data = {
        manifest: m,
        applied: m?.entries.filter((e) => !e.failed).map((e) => e.path) ?? [],
        restore: `node scripts/restore.js --run ${flags.run}`
      };
      error.message = `${error.message}\nApplied so far: ${error.data.applied.length} file(s). Rollback (only if the user decides so): ${error.data.restore}`;
    }
    throw error;
  }

  let pruned = { pruned: [], kept: [], totalBytes: 0 };
  if (!flags['dry-run']) {
    const state = loadState(env);
    for (const e of manifest.entries) {
      if (e.action === 'create' || e.action === 'overwrite') state.targets[e.path] = { sha256: e.after.sha256, runId: plan.runId, at: manifest.finishedAt };
      if (e.action === 'move' || e.action === 'remove') delete state.targets[e.path];
    }
    if (existsSync(store.master)) state.master = { hash: contentHash(readText(store.master).text), runId: plan.runId };
    state.runs.push({ runId: plan.runId, skill: plan.skill, at: manifest.finishedAt, files: manifest.entries.length, config: config });
    saveState(state, env);
    pruned = pruneBackups(config.retention, env);
  }
  return {
    runId: plan.runId,
    status: manifest.status,
    entries: manifest.entries.map((e) => ({ file: tildify(e.path), action: e.action, before: e.before ? fmtBytes(e.before.size) : '-', after: e.after ? fmtBytes(e.after.size) : '-', verified: e.after ? e.after.sha256?.slice(0, 12) : '' })),
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
