#!/usr/bin/env node
// instructions-project: render the proposed AGENTS.md into the shim (and the
// optional Copilot copy), stage proposals + diffs in the run dir, and write
// plan.json for apply.js. Writes only inside ~/.agent-instructions/runs/<id>/.

import { existsSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { run, isMain, UsageError, table, fmtBytes, fmtDelta } from './lib/cli.js';
import { storePaths, tildify, mirrorPath } from './lib/paths.js';
import { loadConfig, runDir } from './lib/config.js';
import { readText, atomicWrite, writeJson, metricsOf, ensureDir, readJson } from './lib/fsx.js';
import { renderShim, renderCopilotCopy, stripRenderedHead } from './lib/render.js';
import { unifiedDiff, diffStats } from './lib/diff.js';
import { parseShimMarker, parseGeneratedMarker } from './lib/markers.js';
import { memoryDirFor } from './lib/memory.js';
import { classify } from './gate.js';

const HELP = `usage: node render.js --run <run-id> [--dir <repo>] [options]

  --agents-from <file>     proposed AGENTS.md text (default: the current AGENTS.md)
  --claude-only <file>     Claude-only content appended to the shim after @AGENTS.md
  --copilot-copy           write .github/copilot-instructions.md as a generated copy (default: archive it)
  --keep-copilot           leave a hand-written .github/copilot-instructions.md alone
  --claude-local <file>    write CLAUDE.local.md from this file (only when the user asked for a personal place)
  --memory-edits <json>    { "<memory file>": "<proposal file>" } — rewritten memory files (frontmatter kept)
  --archive <p,q>          files to move into ~/.agent-instructions/archive/<run-id>/ (superseded memory files)
  --json
Writes runs/<id>/proposal/*, diff/*, plan.json, render.json.`;

async function main(flags) {
  if (!flags.run) throw new UsageError('--run is required');
  const env = process.env;
  const store = storePaths(env);
  const { config } = loadConfig(env);
  const gate = classify(flags.dir ?? process.cwd(), { env });
  const root = gate.root;
  const rel = (p) => relative(root, p).split(sep).join('/');
  const dir = runDir(flags.run, env);
  const proposalDir = join(dir, 'proposal');
  const diffDir = join(dir, 'diff');
  ensureDir(proposalDir);
  ensureDir(diffDir);

  const agentsPath = join(root, 'AGENTS.md');
  const agentsSource = flags['agents-from'] ?? agentsPath;
  if (!existsSync(agentsSource)) throw new UsageError(`AGENTS.md proposal not found: ${agentsSource} (pass --agents-from)`);
  const agentsText = readText(agentsSource).text;
  const currentAgents = existsSync(agentsPath) ? readText(agentsPath).text : '';

  const actions = [];
  const rows = [];
  const stage = (name, path, before, after, status, { same = before === after } = {}) => {
    const p = join(proposalDir, name);
    atomicWrite(p, after);
    atomicWrite(join(diffDir, `${name}.diff`), unifiedDiff(before, after, { from: rel(path), to: 'proposal' }));
    if (same) {
      rows.push({ ...row(rel(path), before, after), status: 'unchanged' });
      return;
    }
    actions.push({ action: 'write', path, from: p, target: name });
    rows.push({ ...row(rel(path), before, after), status: status ?? (before ? 'overwrite' : 'create') });
  };

  // 1. canonical AGENTS.md
  stage('AGENTS.md', agentsPath, currentAgents, agentsText);

  // 2. shim
  const shimPath = join(root, '.claude', 'CLAUDE.md');
  const claudeOnly = flags['claude-only'] ? readText(flags['claude-only']).text : '';
  const shim = renderShim(agentsText, { claudeOnly });
  const currentShim = existsSync(shimPath) ? readText(shimPath).text : '';
  stage('.claude-CLAUDE.md', shimPath, currentShim, shim.text, currentShim && !parseShimMarker(currentShim) ? 'replace hand-written file with shim' : undefined);

  // 3. root CLAUDE.md → migrated into AGENTS.md, file archived
  const rootClaude = join(root, 'CLAUDE.md');
  const archive = (p, why) => {
    const to = join(store.root, 'archive', flags.run, 'repo', basename(root), rel(p));
    actions.push({ action: 'move', path: p, to, target: 'archive' });
    rows.push({ file: rel(p), before: '', after: '', delta: '', diff: '', status: `archive → ${tildify(to)} (${why})` });
  };
  if (existsSync(rootClaude)) archive(rootClaude, 'merged into AGENTS.md; Claude Code reads the shim');

  // 4. Copilot copy or archive
  const copilotPath = join(root, '.github', 'copilot-instructions.md');
  if (flags['copilot-copy']) {
    const copy = renderCopilotCopy(agentsText, { runId: flags.run });
    const currentCopy = existsSync(copilotPath) ? readText(copilotPath).text : '';
    // Idempotent: same body under an older run's marker counts as unchanged.
    const same = currentCopy === copy.text || (parseGeneratedMarker(currentCopy)?.hash === copy.hash && stripRenderedHead(currentCopy) === copy.body);
    stage('copilot-instructions.md', copilotPath, currentCopy, copy.text, undefined, { same });
  } else if (existsSync(copilotPath) && !flags['keep-copilot']) {
    archive(copilotPath, 'merged into AGENTS.md; pass --copilot-copy to keep a generated copy');
  }

  // 5. CLAUDE.local.md only on request
  if (flags['claude-local']) {
    const p = join(root, 'CLAUDE.local.md');
    stage('CLAUDE.local.md', p, existsSync(p) ? readText(p).text : '', readText(flags['claude-local']).text);
  }

  // 6. memory edits and archives
  const memoryDir = memoryDirFor(root, env);
  if (flags['memory-edits']) {
    const edits = readJson(flags['memory-edits']);
    for (const [target, from] of Object.entries(edits)) {
      if (!target.startsWith(memoryDir)) throw new UsageError(`memory edit outside this project's memory dir: ${target}`);
      stage(`memory-${basename(target)}`, target, existsSync(target) ? readText(target).text : '', readText(from).text);
    }
  }
  for (const p of flags.archive ?? []) {
    if (!existsSync(p)) throw new UsageError(`--archive: ${p} does not exist`);
    const to = mirrorPath(join(store.root, 'archive', flags.run), p);
    actions.push({ action: 'move', path: p, to, target: 'archive' });
    rows.push({ file: tildify(p), before: '', after: '', delta: '', diff: '', status: `archive → ${tildify(to)}` });
  }

  const plan = { runId: flags.run, skill: 'instructions-project', root, createdAt: new Date().toISOString(), actions };
  writeJson(join(dir, 'plan.json'), plan);
  writeJson(join(dir, 'render.json'), {
    rows: rows.map((r) => ({ target: r.file, file: r.file, status: r.status })),
    skipped: [],
    thresholdChecks: [{ label: 'AGENTS.md', path: agentsPath, limit: config.thresholds.project_lines, kind: 'lines' }]
  });

  const warnings = [];
  const m = metricsOf(agentsText);
  if (m.lines > config.thresholds.project_lines) warnings.push(`AGENTS.md would have ${m.lines} lines (soft limit ${config.thresholds.project_lines})`);
  return { runId: flags.run, root, plan: join(dir, 'plan.json'), proposalDir, diffDir, actions: actions.length, rows, warnings, sharedRepo: gate.verdict === 'shared' };
}

function row(file, before, after) {
  const b = metricsOf(before);
  const a = metricsOf(after);
  const d = diffStats(before, after);
  return {
    file,
    before: before ? `${b.lines} l / ${fmtBytes(b.bytes)} / ~${b.tokens} t` : '(absent)',
    after: after ? `${a.lines} l / ${fmtBytes(a.bytes)} / ~${a.tokens} t` : '-',
    delta: fmtDelta(b.bytes, a.bytes),
    diff: `+${d.added} -${d.removed}`
  };
}

function render(r) {
  const out = [`run ${r.runId} in ${r.root}: ${r.actions} action(s) → ${r.plan}`];
  out.push(table([['file', 'file'], ['before', 'before'], ['after', 'after'], ['delta', 'delta'], ['diff', 'diff'], ['status', 'status']], r.rows));
  for (const w of r.warnings) out.push(`warning: ${w}`);
  if (r.sharedRepo) out.push('note: shared repository — purely personal lines (communication style) must be flagged for the user');
  out.push(`proposals: ${r.proposalDir}`, `diffs: ${r.diffDir}`);
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  run({
    spec: { run: 'string', dir: 'string', 'agents-from': 'string', 'claude-only': 'string', 'copilot-copy': 'bool', 'keep-copilot': 'bool', 'claude-local': 'string', 'memory-edits': 'string', archive: 'list' },
    help: HELP,
    main,
    render
  });
}
