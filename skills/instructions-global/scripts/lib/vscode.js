// Shared between ali-instructions-global and ali-instructions-project.
// VS Code: find every settings.json we can, parse JSONC, extract the chat
// customization keys, and resolve absent keys against known defaults by version.

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readText } from './fsx.js';
import { parseJsonc } from './jsonc.js';
import { vscodeUserDirs } from './paths.js';

export const KEYS = [
  'chat.agentHost.enabled',
  'chat.agents.claude.preferAgentHost',
  'chat.useClaudeMdFile',
  'chat.useAgentsMdFile',
  'chat.useNestedAgentsMdFiles',
  'chat.instructionsFilesLocations'
];

/** Every settings.json in the user dirs plus profiles; optionally a workspace one. */
export function settingsFiles(env = process.env, { workspace } = {}) {
  const out = [];
  for (const { flavour, dir } of vscodeUserDirs(env)) {
    const main = join(dir, 'settings.json');
    out.push({ scope: 'user', flavour, profile: 'default', path: main, exists: existsSync(main), promptsDir: join(dir, 'prompts') });
    const profiles = join(dir, 'profiles');
    if (existsSync(profiles)) {
      for (const id of readdirSync(profiles).sort()) {
        const p = join(profiles, id, 'settings.json');
        // profiles without their own settings.json inherit the default profile — nothing to read or edit there
        if (statSync(join(profiles, id)).isDirectory() && existsSync(p)) {
          out.push({ scope: 'user', flavour, profile: id, path: p, exists: existsSync(p), promptsDir: join(profiles, id, 'prompts') });
        }
      }
    }
    // Remote servers keep machine-scoped settings next to user ones.
    const machine = join(dirname(dir), 'Machine', 'settings.json');
    if (existsSync(machine)) out.push({ scope: 'machine', flavour, profile: '-', path: machine, exists: true });
  }
  if (workspace) {
    const p = join(workspace, '.vscode', 'settings.json');
    out.push({ scope: 'workspace', flavour: '-', profile: '-', path: p, exists: existsSync(p) });
  }
  return out;
}

export function readSettings(path) {
  if (!existsSync(path)) return { path, exists: false, values: {}, error: null };
  try {
    const parsed = parseJsonc(readText(path).text);
    const values = {};
    for (const key of KEYS) if (key in parsed) values[key] = parsed[key];
    return { path, exists: true, values, error: null };
  } catch (error) {
    return { path, exists: true, values: {}, error: `not parseable as JSONC: ${error.message}` };
  }
}

// The `code` shim is often not on PATH; on macOS the app bundle carries it.
const DEFAULT_CODE_BINARIES = [
  'code',
  'code-insiders',
  '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
  '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code'
];

/** `code --version` → { binary, version, commit } or null when no CLI is found. */
export function codeVersion(binaries = DEFAULT_CODE_BINARIES) {
  for (const binary of binaries) {
    try {
      const out = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      const [version, commit] = out.trim().split(/\r?\n/);
      if (version) return { binary, version, commit };
    } catch {
      /* not installed or not on PATH */
    }
  }
  return null;
}

/** Defaults table from references/vscode-defaults.md (its ```json block). */
export function loadDefaults(referencesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'references')) {
  const file = join(referencesDir, 'vscode-defaults.md');
  if (!existsSync(file)) return { entries: [], source: null };
  const text = readFileSync(file, 'utf8');
  const m = /```json\r?\n([\s\S]*?)```/.exec(text);
  if (!m) return { entries: [], source: file };
  try {
    return { entries: JSON.parse(m[1]).defaults ?? [], source: file };
  } catch {
    return { entries: [], source: file, error: 'defaults block is not valid JSON' };
  }
}

function cmpVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Default of `key` for `version` (e.g. "1.104.0"); { value, since, note } or null when unknown. */
export function defaultFor(key, version, defaults) {
  const rows = defaults.filter((d) => d.key === key && (!version || cmpVersion(version, d.since) >= 0));
  if (!rows.length) return null;
  rows.sort((x, y) => cmpVersion(y.since, x.since));
  return rows[0];
}

/**
 * Effective view for one settings file: for each key, the explicit value or the
 * default by version, or "unknown".
 */
export function effectiveSettings(settings, version, defaults) {
  const out = {};
  for (const key of KEYS) {
    if (key in settings.values) {
      out[key] = { value: settings.values[key], origin: 'explicit' };
      continue;
    }
    const d = version ? defaultFor(key, version, defaults) : null;
    out[key] = d
      ? { value: d.value, origin: `default (since ${d.since})`, note: d.note }
      : { value: null, origin: 'unknown — confirm via the chat customization diagnostics' };
  }
  return out;
}
