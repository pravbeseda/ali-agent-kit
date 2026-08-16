#!/usr/bin/env node
// instructions-global: read-only inventory of every user-level instruction
// surface on this machine. Writes nothing except (with --new-run) the run dir.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run, table, fmtBytes, isMain } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { loadConfig, loadState, newRunId, runDir } from './lib/config.js';
import { fileInfo, readText, writeJson } from './lib/fsx.js';
import { detectSurfaces, findKarpathySkills } from './lib/surfaces.js';
import { listMemoryDirs } from './lib/memory.js';
import { settingsFiles, readSettings, codeVersion, loadDefaults, effectiveSettings } from './lib/vscode.js';
import { classify, readSnapshot, renderBlockBody } from './lib/karpathy.js';
import { selfCheck } from './lib/selfcheck.js';

const HELP = `usage: node inventory.js [--new-run] [--json]

Read-only. Detects surfaces, measures every candidate file (bytes, lines,
~tokens = chars/4, sha256, symlink, BOM/EOL, marker), reads VS Code settings,
lists auto-memory dirs, checks the Karpathy block against the bundled snapshot
(the karpathy.js script does the network fetch), and looks for doubling risks.

  --new-run   create ~/.agent-instructions/runs/<run-id>/ and save inventory.json there
  --json      machine-readable output`;

export async function inventory({ env = process.env, newRun = false } = {}) {
  const store = storePaths(env);
  const { config, path: configPath, exists: configExists } = loadConfig(env);
  const state = loadState(env);
  const surfaces = detectSurfaces(env, { disabled: config.disabled_surfaces });

  const master = fileInfo(store.master);
  const masterText = master.exists ? readText(store.master).text : '';

  const snapshot = readSnapshot();
  const karpathy = {
    enabled: config.karpathy.enabled,
    source: config.karpathy.source,
    pin: config.karpathy.pin,
    snapshot: snapshot ? { ref: snapshot.ref, fetched: snapshot.fetched } : null,
    againstSnapshot: snapshot
      ? classify(masterText, renderBlockBody(snapshot.body, { source: config.karpathy.source })).state
      : 'no snapshot',
    installedAsSkill: findKarpathySkills(env)
  };

  const version = codeVersion();
  const defaults = loadDefaults();
  const vscode = settingsFiles(env).map((f) => {
    const settings = readSettings(f.path);
    return { ...f, ...settings, effective: effectiveSettings(settings, version?.version, defaults.entries) };
  });

  const memory = listMemoryDirs(env).map((m) => ({
    slug: m.slug,
    dir: m.dir,
    projectPath: m.projectPath,
    projectExists: m.projectExists,
    files: m.files.length,
    indexLines: m.files.find((f) => f.path === m.indexPath)?.lines ?? 0
  }));

  const env_ = {
    CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR ?? null,
    CODEX_HOME: env.CODEX_HOME ?? null,
    COPILOT_HOME: env.COPILOT_HOME ?? null,
    COPILOT_CUSTOM_INSTRUCTIONS_DIRS: env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS ?? null,
    AGENT_INSTRUCTIONS_DIR: env.AGENT_INSTRUCTIONS_DIR ?? null
  };

  const warnings = [];
  const codex = surfaces.find((s) => s.id === 'codex');
  if (codex.extra.override) warnings.push(`Codex: ${tildify(codex.extra.override)} shadows AGENTS.md — ask where to write.`);
  const copilot = surfaces.find((s) => s.id === 'copilot-cli');
  if (copilot.extra.legacy) warnings.push(`Copilot CLI: ${tildify(copilot.extra.legacy)} is also read — keep one channel (retire it after approval).`);
  if (copilot.extra.customInstructionsDirs.length) warnings.push(`COPILOT_CUSTOM_INSTRUCTIONS_DIRS=${copilot.extra.customInstructionsDirs.join(',')} adds more instruction dirs — check for doubling.`);
  if (karpathy.installedAsSkill.length) warnings.push(`karpathy-guidelines installed as a skill: ${karpathy.installedAsSkill.map(tildify).join(', ')} — doubles the master block.`);
  const vsProfileFiles = surfaces.find((s) => s.id === 'vscode').extra.profileInstructionFiles;
  if (vsProfileFiles.length) warnings.push(`VS Code profile instruction files exist (${vsProfileFiles.map(tildify).join(', ')}) — legacy channel, retire after approval.`);
  for (const s of surfaces) {
    if (s.file?.symlink) warnings.push(`${tildify(s.target)} is a symlink — replacing needs --replace-symlinks.`);
    if (s.file?.exists && s.file.bom) warnings.push(`${tildify(s.target)} has a UTF-8 BOM.`);
  }
  if (master.exists && master.lines > config.thresholds.master_lines) warnings.push(`master has ${master.lines} lines (soft limit ${config.thresholds.master_lines}).`);
  if (codex.file?.exists && codex.file.bytes > config.thresholds.codex_budget_bytes) warnings.push(`Codex global file is ${fmtBytes(codex.file.bytes)} — early warning before the ${fmtBytes(config.thresholds.codex_cap_bytes)} project-doc cap.`);
  const shared = selfCheck();
  if (!shared.ok) warnings.push(`shared files differ from the sibling skill: ${shared.differences.join(', ')} — update both.`);

  const result = {
    runId: null,
    store: { root: store.root, master, config: { path: configPath, exists: configExists }, state: { exists: existsSync(store.state), lastRun: state.runs.at(-1) ?? null } },
    surfaces: surfaces.map((s) => ({ ...s, targetTilde: s.target ? tildify(s.target) : null })),
    vscode: { version, settingsFiles: vscode, defaultsSource: defaults.source },
    memory,
    karpathy,
    env: env_,
    warnings,
    config
  };
  if (newRun) {
    result.runId = newRunId();
    const dir = runDir(result.runId, env);
    writeJson(join(dir, 'inventory.json'), result);
    result.runDir = dir;
  }
  return result;
}

function render(r) {
  const rows = r.surfaces.map((s) => ({
    surface: s.label,
    detected: s.disabled ? 'disabled' : s.detected,
    file: s.targetTilde ?? '-',
    exists: s.file ? s.file.exists : '-',
    bytes: s.file?.exists ? fmtBytes(s.file.bytes) : '',
    lines: s.file?.exists ? s.file.lines : '',
    tokens: s.file?.exists ? `~${s.file.tokens}` : '',
    marker: s.file?.exists ? (s.marker ? `ours (run ${s.marker.runId})` : 'no') : '',
    symlink: s.file?.exists ? s.file.symlink : ''
  }));
  const lines = [];
  lines.push(r.runId ? `run: ${r.runId} (${r.runDir})` : 'run: (none — pass --new-run to open one)');
  lines.push(`master: ${tildify(r.store.master.path)} ${r.store.master.exists ? `${r.store.master.lines} lines, ${fmtBytes(r.store.master.bytes)}` : 'absent (first run: proposal = union of targets)'}`);
  lines.push('');
  lines.push(table([['surface', 'surface'], ['detected', 'detected'], ['file', 'file'], ['exists', 'exists'], ['bytes', 'bytes'], ['lines', 'lines'], ['tokens', '~tokens (chars/4)'], ['marker', 'marker'], ['symlink', 'symlink']], rows));
  lines.push('');
  lines.push(`Karpathy: enabled=${r.karpathy.enabled} state vs snapshot=${r.karpathy.againstSnapshot} snapshot ref=${r.karpathy.snapshot?.ref ?? '-'} pin=${r.karpathy.pin ?? '-'}`);
  lines.push(`VS Code CLI: ${r.vscode.version ? `${r.vscode.version.binary} ${r.vscode.version.version}` : 'not on PATH'}`);
  for (const f of r.vscode.settingsFiles) {
    lines.push(`  ${tildify(f.path)} [${f.flavour}/${f.profile}] ${f.exists ? '' : '(absent)'}${f.error ? ` ERROR ${f.error}` : ''}`);
    for (const [key, v] of Object.entries(f.effective)) lines.push(`    ${key} = ${JSON.stringify(v.value)} (${v.origin})`);
  }
  lines.push(`memory dirs: ${r.memory.length}`);
  for (const m of r.memory) lines.push(`  ${m.slug} → ${m.projectPath ?? 'path not found on disk'} (${m.files} files, MEMORY.md ${m.indexLines} lines)`);
  if (r.warnings.length) {
    lines.push('', 'warnings:');
    for (const w of r.warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  run({
    spec: { 'new-run': 'bool' },
    help: HELP,
    main: (flags) => inventory({ newRun: !!flags['new-run'] }),
    render
  });
}
