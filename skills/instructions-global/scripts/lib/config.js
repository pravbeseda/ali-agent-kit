// Shared between ali-instructions-global and ali-instructions-project.
// ~/.agent-instructions/config.json and state.json, with defaults and run ids.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readJson, writeJson, ensureDir } from './fsx.js';
import { storePaths } from './paths.js';

export const KARPATHY_SOURCE =
  'https://raw.githubusercontent.com/multica-ai/andrej-karpathy-skills/refs/heads/main/skills/karpathy-guidelines/SKILL.md';

export const DEFAULT_CONFIG = {
  thresholds: {
    master_lines: 150,
    project_lines: 200,
    memory_index_lines: 200,
    codex_budget_bytes: 24 * 1024,
    codex_cap_bytes: 32 * 1024
  },
  retention: 10,
  karpathy: { enabled: true, source: KARPATHY_SOURCE, pin: null },
  disabled_surfaces: [],
  git_emails: [],
  git_logins: [],
  copilot_copy: false
};

function merge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return extra ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra ?? {})) {
    out[key] = key in base ? merge(base[key], value) : value;
  }
  return out;
}

/** Effective config: defaults overlaid with the user's file. Unknown keys are kept. */
export function loadConfig(env = process.env) {
  const { config } = storePaths(env);
  const user = existsSync(config) ? readJson(config) : {};
  return { config: merge(DEFAULT_CONFIG, user), path: config, exists: existsSync(config) };
}

export function loadState(env = process.env) {
  const { state } = storePaths(env);
  return readJson(state, { version: 1, runs: [], targets: {}, master: null });
}

export function saveState(state, env = process.env) {
  const paths = storePaths(env);
  ensureDir(paths.root);
  writeJson(paths.state, state);
}

/** `20260816-141530-a1b2` — sortable, unique enough for one machine. */
export function newRunId(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

export function runDir(runId, env = process.env) {
  const dir = join(storePaths(env).runs, runId);
  ensureDir(dir);
  return dir;
}
