#!/usr/bin/env node
// instructions-project: read-only inventory of one repository's instruction
// files, the shim state, VS Code workspace overrides, this project's auto
// memory, and the global master/state. Writes only the run dir (--new-run).

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { run, isMain, table, fmtBytes } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { loadConfig, loadState, newRunId, runDir } from './lib/config.js';
import { fileInfo, readText, writeJson, walkFiles } from './lib/fsx.js';
import { parseShimMarker, parseGeneratedMarker, contentHash } from './lib/markers.js';
import { memoryDirFor } from './lib/memory.js';
import { settingsFiles, readSettings } from './lib/vscode.js';
import { detectSurfaces } from './lib/surfaces.js';
import { selfCheck } from './lib/selfcheck.js';
import { classify } from './gate.js';
import { shimImportState } from './lib/render.js';

const HELP = `usage: node inventory.js [--dir <repo>] [--new-run] [--json]

Read-only. Lists every instruction file of the repository (root and nested,
path-scoped ones inventory-only), the shim state, .vscode/settings.json
overrides, this project's Claude auto-memory dir, the global master + state,
and the Codex global+project size chain.`;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'vendor', 'target', '.venv', 'venv', '__pycache__', '.next', '.turbo', 'coverage']);

function walkRepo(root, maxDepth = 6) {
  const out = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) visit(full, depth + 1);
      } else out.push(full);
    }
  };
  visit(root, 0);
  return out;
}

export function projectInventory({ dir = process.cwd(), env = process.env, newRun = false } = {}) {
  const gate = classify(dir, { env });
  const root = gate.root;
  const rel = (p) => relative(root, p).split(sep).join('/');
  const store = storePaths(env);
  const { config } = loadConfig(env);
  const state = loadState(env);

  const rootFiles = {
    agents: join(root, 'AGENTS.md'),
    agentsOverride: join(root, 'AGENTS.override.md'),
    claudeRoot: join(root, 'CLAUDE.md'),
    claudeShim: join(root, '.claude', 'CLAUDE.md'),
    claudeLocal: join(root, 'CLAUDE.local.md'),
    copilot: join(root, '.github', 'copilot-instructions.md'),
    gemini: join(root, 'GEMINI.md')
  };
  const files = {};
  for (const [key, p] of Object.entries(rootFiles)) files[key] = { ...fileInfo(p), rel: rel(p) };

  const all = walkRepo(root);
  const nested = {
    agents: all.filter((p) => /(^|[\\/])AGENTS(\.override)?\.md$/.test(p) && p !== rootFiles.agents && p !== rootFiles.agentsOverride).map(rel),
    claude: all.filter((p) => /(^|[\\/])CLAUDE\.md$/.test(p) && p !== rootFiles.claudeRoot && p !== rootFiles.claudeShim).map(rel),
    claudeRules: walkFiles(join(root, '.claude', 'rules')).filter((p) => p.endsWith('.md')).map(rel),
    copilotInstructions: walkFiles(join(root, '.github', 'instructions')).filter((p) => p.endsWith('.instructions.md')).map(rel)
  };

  const agentsText = files.agents.exists ? readText(rootFiles.agents).text : null;
  const agentsHash = agentsText === null ? null : contentHash(agentsText);
  let shim = { exists: files.claudeShim.exists, state: 'absent' };
  if (files.claudeShim.exists) {
    const text = readText(rootFiles.claudeShim).text;
    const marker = parseShimMarker(text);
    const importState = shimImportState(text);
    const imports = importState === 'current';
    if (!marker) shim = { exists: true, state: 'not-a-shim', imports, note: 'a hand-written .claude/CLAUDE.md — merge into AGENTS.md and replace with the shim' };
    else if (!agentsHash) shim = { exists: true, state: 'orphan', marker, note: 'shim exists but AGENTS.md is missing' };
    else if (importState === 'stale') shim = { exists: true, state: 'stale-import', marker, imports, note: 'shim imports @AGENTS.md, which Claude Code resolves to .claude/AGENTS.md — re-render (--sync-only)' };
    else if (marker.hash === agentsHash) shim = { exists: true, state: 'in-sync', marker, imports };
    else shim = { exists: true, state: 'drift', marker, imports, note: 'AGENTS.md changed since the shim was written — re-render (--sync-only)' };
  }
  let copilotCopy = null;
  if (files.copilot.exists) {
    const marker = parseGeneratedMarker(readText(rootFiles.copilot).text);
    copilotCopy = marker ? { generated: true, state: marker.hash === agentsHash ? 'in-sync' : 'drift', marker } : { generated: false, state: 'hand-written' };
  }

  const vscode = settingsFiles(env, { workspace: root }).filter((f) => f.scope === 'workspace').map((f) => ({ ...f, ...readSettings(f.path) }));

  const memoryDir = memoryDirFor(root, env);
  const memory = {
    dir: memoryDir,
    exists: existsSync(memoryDir),
    files: existsSync(memoryDir) ? readdirSync(memoryDir).filter((f) => f.endsWith('.md')).sort().map((f) => fileInfo(join(memoryDir, f))) : []
  };

  const globalMaster = fileInfo(store.master);
  const global = {
    master: globalMaster,
    stateExists: existsSync(store.state),
    lastGlobalRun: state.runs.filter((r) => r.skill === 'instructions-global').at(-1) ?? null
  };
  const codexGlobal = detectSurfaces(env).find((s) => s.id === 'codex');
  const codexChain = (codexGlobal.file?.exists ? codexGlobal.file.bytes : 0) + (files.agents.exists ? files.agents.bytes : 0);

  const warnings = [];
  if (!global.lastGlobalRun) warnings.push('instructions-global has never run on this machine — deduplicating against an unaudited global is meaningless; continuing anyway.');
  if (files.agentsOverride.exists) warnings.push('AGENTS.override.md at the root shadows AGENTS.md for Codex — ask before touching either.');
  if (nested.agents.length) warnings.push(`nested AGENTS.md files (inventory only): ${nested.agents.join(', ')}`);
  if (nested.claude.length) warnings.push(`nested CLAUDE.md files (inventory only): ${nested.claude.join(', ')}`);
  if (files.claudeRoot.exists && files.claudeShim.exists) warnings.push('both CLAUDE.md and .claude/CLAUDE.md exist — Claude Code reads both; the root one is migrated into AGENTS.md.');
  if (files.claudeRoot.exists && files.claudeRoot.symlink) warnings.push('CLAUDE.md is a symlink — replacing needs --replace-symlinks.');
  if (files.agents.exists && files.agents.lines > config.thresholds.project_lines) warnings.push(`AGENTS.md has ${files.agents.lines} lines (soft limit ${config.thresholds.project_lines}).`);
  if (codexChain > config.thresholds.codex_budget_bytes) warnings.push(`Codex chain (global ${fmtBytes(codexGlobal.file?.bytes ?? 0)} + AGENTS.md ${fmtBytes(files.agents.bytes ?? 0)}) = ${fmtBytes(codexChain)} — early warning before the ${fmtBytes(config.thresholds.codex_cap_bytes)} project-doc cap.`);
  if (memory.exists) {
    const idx = memory.files.find((f) => f.path.endsWith('MEMORY.md'));
    if (idx && idx.lines > config.thresholds.memory_index_lines) warnings.push(`MEMORY.md has ${idx.lines} lines (limit ${config.thresholds.memory_index_lines}; Claude loads the first 200 lines / 25 KB).`);
  }
  const shared = selfCheck();
  if (!shared.ok) warnings.push(`shared files differ from the sibling skill: ${shared.differences.join(', ')} — update both.`);

  const result = { runId: null, root, gate, files, nested, shim, copilotCopy, vscode, memory, global, codexChain, warnings, config };
  if (newRun) {
    result.runId = newRunId();
    const d = runDir(result.runId, env);
    writeJson(join(d, 'inventory.json'), result);
    result.runDir = d;
  }
  return result;
}

function render(r) {
  const rows = Object.entries(r.files).map(([key, f]) => ({
    key,
    file: f.rel,
    exists: f.exists,
    bytes: f.exists ? fmtBytes(f.bytes) : '',
    lines: f.exists ? f.lines : '',
    tokens: f.exists ? `~${f.tokens}` : '',
    symlink: f.exists ? f.symlink : ''
  }));
  const out = [
    r.runId ? `run: ${r.runId} (${r.runDir})` : 'run: (none — pass --new-run to open one)',
    `repo: ${r.root} — ${r.gate.git ? r.gate.verdict : 'not a git repository'}`,
    '',
    table([['key', 'file'], ['file', 'path'], ['exists', 'exists'], ['bytes', 'bytes'], ['lines', 'lines'], ['tokens', '~tokens (chars/4)'], ['symlink', 'symlink']], rows),
    '',
    `shim .claude/CLAUDE.md: ${r.shim.state}${r.shim.note ? ` — ${r.shim.note}` : ''}`,
    `copilot-instructions.md: ${r.copilotCopy ? `${r.copilotCopy.generated ? 'generated copy' : 'hand-written'} (${r.copilotCopy.state})` : 'absent'}`,
    `path-scoped / nested (inventory only): AGENTS ${r.nested.agents.length}, CLAUDE ${r.nested.claude.length}, .claude/rules ${r.nested.claudeRules.length}, .github/instructions ${r.nested.copilotInstructions.length}`,
    `memory: ${tildify(r.memory.dir)} ${r.memory.exists ? `(${r.memory.files.length} files)` : '(none)'}`,
    `global master: ${r.global.master.exists ? `${r.global.master.lines} lines` : 'absent'}; last global run: ${r.global.lastGlobalRun?.runId ?? 'never'}`,
    `codex chain global+project: ${fmtBytes(r.codexChain)}`
  ];
  for (const v of r.vscode) if (v.exists) out.push(`.vscode/settings.json: ${JSON.stringify(v.values)}${v.error ? ` ERROR ${v.error}` : ''}`);
  if (r.warnings.length) out.push('', 'warnings:', ...r.warnings.map((w) => `  - ${w}`));
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  run({ spec: { dir: 'string', 'new-run': 'bool' }, help: HELP, main: (flags) => projectInventory({ dir: flags.dir, newRun: !!flags['new-run'] }), render });
}
