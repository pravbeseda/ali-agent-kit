import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { packageRoot } from '../src/config.js';
import { buildAll, homeBloated, repoSolo, repoMixed, repoTeam, dirNoGit } from './fixtures/instructions/make-fixtures.js';

const G = join(packageRoot, 'skills', 'instructions-global');
const P = join(packageRoot, 'skills', 'instructions-project');
const lib = (name) => import(join(G, 'scripts', 'lib', name));

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'ali-instr-')));

/** Run a skill script with a fake HOME; returns { code, json, stdout }. */
function runScript(skillDir, script, args, { home, cwd, env = {} } = {}) {
  const r = spawnSync(process.execPath, [join(skillDir, 'scripts', script), ...args, '--json'], {
    cwd: cwd ?? home,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, ...env }
  });
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* not JSON */
  }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

// --- shared files -----------------------------------------------------------

test('shared scripts and references are byte-identical in both skills', async () => {
  const { selfCheck, SHARED } = await lib('selfcheck.js');
  const a = selfCheck(G);
  assert.deepEqual(a.differences, [], `update both copies: ${a.differences.join(', ')}`);
  assert.equal(a.sibling, P);
  assert.ok(SHARED.includes('scripts/lib'));
});

test('least privilege: the global skill has no repo logic, the project skill no home-file logic', () => {
  const globalApply = readFileSync(join(G, 'scripts', 'apply.js'), 'utf8');
  const projectApply = readFileSync(join(P, 'scripts', 'apply.js'), 'utf8');
  assert.match(globalApply, /allowedRoots/);
  assert.doesNotMatch(globalApply, /rev-parse|show-toplevel/);
  assert.match(projectApply, /memoryDirFor\(repoRoot/);
  assert.doesNotMatch(projectApply, /agentDirs|jetbrainsCopilotDir|vscodeUserDirs/);
});

// --- lib units ---------------------------------------------------------------

test('jsonc: parse with comments/trailing commas and edit top-level keys in place', async () => {
  const { parseJsonc, setTopLevelKey } = await lib('jsonc.js');
  const src = '{\n  // c\n  "a": 1,\n  "chat.instructionsFilesLocations": { ".github/instructions": true }, /* x */\n}\n';
  assert.deepEqual(parseJsonc(src), { a: 1, 'chat.instructionsFilesLocations': { '.github/instructions': true } });
  const edited = setTopLevelKey(src, 'chat.useClaudeMdFile', false);
  assert.match(edited, /\/\/ c/);
  assert.match(edited, /\/\* x \*\//);
  assert.equal(parseJsonc(edited)['chat.useClaudeMdFile'], false);
  const removed = setTopLevelKey(edited, 'a', undefined);
  assert.equal(parseJsonc(removed).a, undefined);
  assert.equal(setTopLevelKey('', 'k', 1).trim(), '{\n  "k": 1\n}');
  const crlf = '{\r\n  "a": 1\r\n}\r\n';
  assert.match(setTopLevelKey(crlf, 'b', 2), /"b": 2\r\n\}/);
});

test('markers: only-blocks, generated marker, karpathy fences', async () => {
  const m = await lib('markers.js');
  const text = 'a\n<!-- only: claude -->\nclaude only\n<!-- /only -->\n<!-- only: codex, copilot -->\nnot claude\n<!-- /only -->\nz\n';
  assert.equal(m.stripOnlyBlocks(text, 'claude'), 'a\nclaude only\nz\n');
  assert.equal(m.stripOnlyBlocks(text, 'codex'), 'a\nnot claude\nz\n');
  const marker = m.generatedMarker({ skill: 'instructions-global', source: '~/.agent-instructions/global.md', runId: 'r1', hash: 'a'.repeat(64) });
  assert.deepEqual(m.parseGeneratedMarker(marker), { skill: 'instructions-global', source: '~/.agent-instructions/global.md', runId: 'r1', hash: 'a'.repeat(64) });
  const withBlock = m.putKarpathyBlock('# master\n\n## Code\n- x\n', { source: 'u', ref: 'r', hash: 'b'.repeat(64), body: '## Karpathy\n\ntext' });
  const found = m.findKarpathyBlock(withBlock);
  assert.equal(found.header.ref, 'r');
  assert.equal(found.body, '## Karpathy\n\ntext');
  assert.equal(m.removeKarpathyBlock(withBlock), '# master\n\n## Code\n- x\n');
  const replaced = m.putKarpathyBlock(withBlock, { source: 'u', ref: 'r2', hash: 'c'.repeat(64), body: 'new' });
  assert.equal(m.findKarpathyBlock(replaced).body, 'new');
  assert.equal((replaced.match(/karpathy-guidelines: begin/g) || []).length, 1);
});

test('dupes: exact, near, secrets, non-English lines normalise', async () => {
  const { ruleLines, findDuplicates, findSecrets } = await lib('dupes.js');
  const text = ['# H', '- Never push to main.', 'Do not push to main.', '```', 'Never push to main.', '```', 'Prefer pnpm over npm.', '- prefer PNPM over npm', 'OpenAI key: sk-abcdefghijklmnopqrstuvwxyz123456', '\u041e\u0442\u0432\u0435\u0447\u0430\u0439 \u043a\u0440\u0430\u0442\u043a\u043e.'].join('\n');
  const lines = ruleLines(text, 'f.md');
  assert.equal(lines.length, 6, 'fence content and heading are skipped');
  const { exact, near } = findDuplicates(lines);
  assert.equal(exact.length, 1);
  assert.equal(exact[0][0].text, 'Prefer pnpm over npm.');
  assert.ok(near.some((p) => /push to main/.test(p.a.text) && /push to main/.test(p.b.text)), 'near-duplicate hint for the two push rules');
  assert.equal(findSecrets(lines).length, 1);
  assert.ok(lines.at(-1).norm.length > 0, 'Cyrillic survives normalisation');
});

test('memory: slug round trip resolves hyphenated directory names', async () => {
  const { slugOf, resolveSlug, splitFrontmatter } = await lib('memory.js');
  const root = tmp();
  const project = join(root, 'Work-space', 'my-repo');
  mkdirSync(project, { recursive: true });
  const slug = slugOf(project);
  assert.equal(resolveSlug(slug), project);
  assert.equal(resolveSlug('-no-such-dir-anywhere-xyz'), null);
  const { frontmatter, body } = splitFrontmatter('---\nname: x\n---\nbody\n');
  assert.equal(frontmatter, '---\nname: x\n---\n');
  assert.equal(body, 'body\n');
});

test('render: global targets carry marker (+ frontmatter for Copilot), shim carries the AGENTS.md hash', async () => {
  const { renderGlobal, renderShim, renderCopilotCopy, stripRenderedHead } = await lib('render.js');
  const { contentHash, parseShimMarker } = await lib('markers.js');
  const master = '# M\n\n<!-- only: codex -->\ncodex line\n<!-- /only -->\n- rule\n';
  const claude = renderGlobal(master, { target: 'claude', runId: 'r' });
  assert.doesNotMatch(claude.text, /codex line/);
  assert.match(claude.text, /^<!-- generated by instructions-global/);
  const copilot = renderGlobal(master, { target: 'copilot-cli', runId: 'r' });
  assert.match(copilot.text, /^---\napplyTo: "\*\*"\n---\n<!-- generated/);
  assert.equal(stripRenderedHead(copilot.text), '# M\n\n- rule\n');
  const codex = renderGlobal(master, { target: 'codex', runId: 'r' });
  assert.match(codex.text, /codex line/);
  const shim = renderShim('# A\n', { claudeOnly: 'Claude only.' });
  assert.equal(parseShimMarker(shim.text).hash, contentHash('# A\n'));
  assert.match(shim.text, /\n@AGENTS\.md\n\nClaude only\.\n$/);
  const copy = renderCopilotCopy('# A\n', { runId: 'r' });
  assert.match(copy.text, /generated by instructions-project from AGENTS\.md/);
});

test('karpathy: classify states and offline fallback', async () => {
  const k = await lib('karpathy.js');
  const m = await lib('markers.js');
  const snap = k.readSnapshot(join(G, 'references', 'karpathy-guidelines.md'));
  assert.ok(snap.body.includes('## 1. Think Before Coding'));
  const rendered = k.renderBlockBody(snap.body, { source: 'src' });
  assert.match(rendered, /^## Karpathy Guidelines/);
  assert.match(rendered, /\n### 2\. Simplicity First/);
  assert.equal(k.classify('# m\n', rendered).state, 'absent');
  const hash = m.contentHash(rendered);
  const master = m.putKarpathyBlock('# m\n', { source: 'src', ref: 'r', hash, body: rendered });
  assert.equal(k.classify(master, rendered).state, 'current');
  assert.equal(k.classify(master, rendered + '\nnew upstream line').state, 'upstream-ahead');
  const edited = master.replace('Surface tradeoffs', 'Surface tradeoffs (edited)');
  assert.equal(k.classify(edited, rendered).state, 'local-edit');
  assert.equal(k.classify(edited, rendered + '\nx').state, 'both');
  assert.deepEqual(k.sectionsOf(rendered).map((s) => s.number), [1, 2, 3, 4]);
  await assert.rejects(k.fetchUpstream('https://example.invalid/x', { fetchImpl: async () => { throw new Error('offline'); } }), /offline/);
});

test('diff: unified diff for small texts', async () => {
  const { unifiedDiff, diffStats } = await lib('diff.js');
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n'), '');
  const d = unifiedDiff('a\nb\nc\n', 'a\nx\nc\n', { from: 'old', to: 'new' });
  assert.match(d, /^--- old\n\+\+\+ new\n@@ -1,3 \+1,3 @@\n a\n-b\n\+x\n c\n$/);
  assert.match(unifiedDiff('', 'a\nb\n'), /@@ -0,0 \+1,2 @@/);
  assert.deepEqual(diffStats('a\nb\n', 'a\nb\nc\n'), { added: 1, removed: 0 });
});

test('cli: parseArgs handles bools, values, lists, unknown flags', async () => {
  const { parseArgs, UsageError } = await lib('cli.js');
  const { flags, positional } = parseArgs(['--run', 'r1', '--vscode', '--archive', 'a,b', '--archive=c', 'x'], { run: 'string', vscode: 'bool', archive: 'list' });
  assert.deepEqual(flags, { run: 'r1', vscode: true, archive: ['a', 'b', 'c'] });
  assert.deepEqual(positional, ['x']);
  assert.throws(() => parseArgs(['--nope'], {}), UsageError);
});

test('vscode: defaults by version and effective values', async () => {
  const v = await lib('vscode.js');
  const { entries } = v.loadDefaults(join(G, 'references'));
  assert.ok(entries.length >= 4);
  assert.equal(v.defaultFor('chat.useClaudeMdFile', '1.120.0', entries).value, true);
  assert.equal(v.defaultFor('chat.useClaudeMdFile', '1.100.0', entries), null);
  const eff = v.effectiveSettings({ values: { 'chat.useClaudeMdFile': false } }, '1.130.0', entries);
  assert.equal(eff['chat.useClaudeMdFile'].origin, 'explicit');
  assert.equal(eff['chat.useAgentsMdFile'].value, true);
  assert.match(v.effectiveSettings({ values: {} }, null, entries)['chat.useAgentsMdFile'].origin, /unknown/);
});

// --- apply engine -----------------------------------------------------------

test('apply: backup, verify, manifest, refuse outside roots, symlink guard, restore, retention', async () => {
  const { applyPlan, restoreRun, pruneBackups, listRuns, ApplyError } = await lib('apply.js');
  const home = tmp();
  const env = { HOME: home };
  const target = join(home, '.claude', 'CLAUDE.md');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(target, 'old\n');
  const src = join(home, 'proposal.md');
  writeFileSync(src, 'new\n');
  const settings = join(home, 'settings.json');
  writeFileSync(settings, '{\n  "a": 1 // keep\n}\n');
  const legacy = join(home, '.copilot', 'copilot-instructions.md');
  mkdirSync(join(home, '.copilot'), { recursive: true });
  writeFileSync(legacy, 'legacy\n');

  const plan = {
    runId: 'r1',
    skill: 't',
    actions: [
      { action: 'write', path: target, from: src },
      { action: 'settings', path: settings, set: { 'chat.useClaudeMdFile': false } },
      { action: 'move', path: legacy, to: join(home, '.agent-instructions', 'archive', 'r1', 'legacy.md') }
    ]
  };
  const dry = applyPlan(plan, { allow: [home], dryRun: true, env });
  assert.equal(dry.status, 'dry-run');
  assert.equal(readFileSync(target, 'utf8'), 'old\n');

  const manifest = applyPlan(plan, { allow: [home], env });
  assert.equal(manifest.status, 'complete');
  assert.equal(readFileSync(target, 'utf8'), 'new\n');
  assert.match(readFileSync(settings, 'utf8'), /"a": 1, \/\/ keep/);
  assert.match(readFileSync(settings, 'utf8'), /"chat.useClaudeMdFile": false/);
  assert.ok(!existsSync(legacy));
  assert.ok(existsSync(join(home, '.agent-instructions', 'backups', 'r1', 'manifest.json')));
  assert.equal(readFileSync(manifest.entries[0].backup, 'utf8'), 'old\n');
  assert.equal(manifest.entries[0].action, 'overwrite');

  assert.throws(() => applyPlan({ runId: 'r2', skill: 't', actions: [{ action: 'write', path: join(tmp(), 'x.md'), from: src }] }, { allow: [home], env }), ApplyError);
  if (platform() !== 'win32') {
    const linkTarget = join(home, '.codex', 'AGENTS.md');
    mkdirSync(join(home, '.codex'), { recursive: true });
    symlinkSync(target, linkTarget);
    assert.throws(() => applyPlan({ runId: 'r3', skill: 't', actions: [{ action: 'write', path: linkTarget, from: src }] }, { allow: [home], env }), /symlink/);
  }
  // partial failure: second action moves a missing file
  try {
    applyPlan({ runId: 'r4', skill: 't', actions: [{ action: 'write', path: target, from: src }, { action: 'move', path: join(home, 'missing'), to: join(home, 'x') }] }, { allow: [home], env });
    assert.fail('should throw');
  } catch (error) {
    assert.ok(error instanceof ApplyError);
    assert.equal(error.data.manifest.status, 'partial');
    assert.equal(error.data.manifest.entries.filter((e) => !e.failed).length, 1);
  }

  const restored = restoreRun(manifest);
  assert.equal(restored.length, 3);
  assert.equal(readFileSync(target, 'utf8'), 'old\n');
  assert.equal(readFileSync(settings, 'utf8'), '{\n  "a": 1 // keep\n}\n');
  assert.equal(readFileSync(legacy, 'utf8'), 'legacy\n');

  for (let i = 5; i < 20; i++) applyPlan({ runId: `r${String(i).padStart(2, '0')}`, skill: 't', actions: [{ action: 'write', path: target, from: src }] }, { allow: [home], env });
  const pr = pruneBackups(10, env);
  assert.equal(pr.kept.length, 10);
  assert.ok(pr.pruned.includes('r1'));
  assert.equal(listRuns(env).length, 10);
});

// --- global scripts end to end ------------------------------------------------

test('global flow: inventory → render → apply → drift → idempotent re-render → restore', async () => {
  const root = tmp();
  const home = homeBloated(root);
  const inv = runScript(G, 'inventory.js', ['--new-run'], { home });
  assert.equal(inv.code, 0, inv.stderr);
  const runId = inv.json.runId;
  assert.ok(runId);
  const ids = Object.fromEntries(inv.json.surfaces.map((s) => [s.id, s]));
  assert.equal(ids.claude.detected, true);
  assert.equal(ids.codex.detected, true);
  assert.equal(ids['copilot-cli'].detected, true);
  assert.equal(ids.jetbrains.detected, false);
  assert.ok(inv.json.warnings.some((w) => /copilot-instructions\.md is also read/.test(w)));
  assert.equal(inv.json.memory.length, 1);
  assert.equal(inv.json.karpathy.againstSnapshot, 'absent');
  assert.equal(inv.json.store.master.exists, false);
  if (platform() === 'darwin') {
    assert.ok(inv.json.vscode.settingsFiles.length >= 2, 'stable + insiders settings found');
    assert.ok(inv.json.warnings.some((w) => /profile instruction files/.test(w)));
  }

  const dupes = runScript(G, 'dupes.js', [join(home, '.claude', 'CLAUDE.md'), join(home, '.codex', 'AGENTS.md')], { home });
  assert.equal(dupes.code, 0);
  assert.equal(dupes.json.secrets.length, 1);
  assert.ok(dupes.json.exact.length >= 1);

  const kar = runScript(G, 'karpathy.js', ['status', '--offline'], { home });
  assert.equal(kar.json.state, 'absent');
  assert.equal(kar.json.upstream.origin, 'snapshot');

  const v1 = join(root, 'v1.md');
  writeFileSync(v1, '# Global\n\n## Communication\n- Answer briefly.\n\n## Workflow\n- Never push to main.\n');
  const v2 = join(root, 'v2.md');
  const put = runScript(G, 'karpathy.js', ['put', '--master', v1, '--out', v2, '--offline'], { home });
  assert.equal(put.code, 0, put.stderr);
  assert.match(readFileSync(v2, 'utf8'), /karpathy-guidelines: begin/);

  const settingsPath = join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  const parked = join(root, 'parked.md');
  writeFileSync(parked, '# Parked\n\n- (from ~/.claude/CLAUDE.md:14, 2026-08-16) For the foo-service repo, run `make dev` before tests.\n');
  const memFile = join(home, '.claude', 'projects', '-Users-me-Workspace-foo-service', 'memory', 'short-answers.md');
  const memNew = join(root, 'short-answers.md');
  writeFileSync(memNew, '---\nname: short-answers\ndescription: communication preference\n---\n');
  const memEdits = join(root, 'memory-edits.json');
  writeFileSync(memEdits, JSON.stringify({ [memFile]: memNew }));
  const renderArgs = ['--run', runId, '--master-from', v2, '--archive', join(home, '.copilot', 'copilot-instructions.md'), '--parked', parked, '--memory-edits', memEdits];
  if (platform() === 'darwin') renderArgs.push('--vscode-settings', settingsPath);
  const ren = runScript(G, 'render.js', renderArgs, { home });
  assert.equal(ren.code, 0, ren.stderr);
  const plan = JSON.parse(readFileSync(ren.json.plan, 'utf8'));
  const targets = plan.actions.map((a) => a.target);
  assert.ok(targets.includes('master') && targets.includes('claude') && targets.includes('codex') && targets.includes('copilot-cli'));
  assert.ok(!targets.includes('jetbrains'));
  assert.ok(targets.includes('parked.md'));
  assert.ok(targets.some((t) => /^memory-.*short-answers\.md$/.test(t)));
  assert.ok(ren.json.skipped.some((s) => s.id === 'jetbrains'));
  assert.ok(existsSync(join(ren.json.diffDir, 'claude.diff')));

  const dry = runScript(G, 'apply.js', ['--run', runId, '--dry-run'], { home });
  assert.equal(dry.code, 0, dry.stderr);
  assert.ok(!existsSync(join(home, '.agent-instructions', 'global.md')));

  const app = runScript(G, 'apply.js', ['--run', runId], { home });
  assert.equal(app.code, 0, app.stderr);
  assert.equal(app.json.status, 'complete');
  assert.ok(existsSync(join(home, '.agent-instructions', 'global.md')));
  assert.match(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), /^<!-- generated by instructions-global/);
  assert.match(readFileSync(join(home, '.copilot', 'instructions', 'global.instructions.md'), 'utf8'), /^---\napplyTo/);
  assert.ok(!existsSync(join(home, '.copilot', 'copilot-instructions.md')));
  assert.match(readFileSync(join(home, '.agent-instructions', 'parked.md'), 'utf8'), /foo-service/);
  assert.equal(readFileSync(memFile, 'utf8'), '---\nname: short-answers\ndescription: communication preference\n---\n');
  if (platform() === 'darwin') {
    const s = readFileSync(settingsPath, 'utf8');
    assert.match(s, /"chat.useClaudeMdFile": false/);
    assert.match(s, /"~\/.copilot\/instructions": true/);
    assert.match(s, /\/\/ editor/);
  }
  const state = JSON.parse(readFileSync(join(home, '.agent-instructions', 'state.json'), 'utf8'));
  assert.equal(state.runs.length, 1);
  assert.ok(state.targets[join(home, '.claude', 'CLAUDE.md')]);

  let drift = runScript(G, 'drift.js', [], { home });
  assert.equal(drift.json.anyChange, false);
  assert.ok(drift.json.targets.every((t) => t.state === 'unchanged'));

  // idempotent: rendering the same master again yields no actions
  const inv2 = runScript(G, 'inventory.js', ['--new-run'], { home });
  const ren2 = runScript(G, 'render.js', ['--run', inv2.json.runId], { home });
  assert.equal(ren2.json.actions, 0);
  assert.equal(inv2.json.karpathy.againstSnapshot, 'current');
  assert.ok(inv2.json.surfaces.find((s) => s.id === 'claude').marker);

  // hand edit → drift; master edit → master-moved
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8') + '- by hand\n');
  drift = runScript(G, 'drift.js', ['--diff'], { home });
  assert.equal(drift.json.targets.find((t) => t.surface === 'claude').state, 'hand-edited');
  assert.match(drift.json.targets.find((t) => t.surface === 'claude').diff, /-- by hand/);
  writeFileSync(join(home, '.agent-instructions', 'global.md'), readFileSync(join(home, '.agent-instructions', 'global.md'), 'utf8').replace('Answer briefly.', 'Answer briefly, always.'));
  drift = runScript(G, 'drift.js', [], { home });
  assert.equal(drift.json.master.state, 'edited since last run');
  assert.equal(drift.json.targets.find((t) => t.surface === 'codex').state, 'master-moved');
  assert.equal(drift.json.targets.find((t) => t.surface === 'claude').state, 'both');

  const rep = runScript(G, 'report.js', ['--run', runId, '--write'], { home });
  assert.equal(rep.code, 0, rep.stderr);
  assert.match(rep.json.markdown, /### Files \(applied/);
  assert.match(rep.json.markdown, /Sync status per surface/);
  assert.match(rep.json.markdown, /jetbrains \| - \| skipped/);

  const review = runScript(G, 'review.js', ['--run', runId], { home });
  assert.equal(review.code, 0, review.stderr);
  assert.ok(review.json.files >= 4);
  assert.ok(existsSync(join(review.json.dir, 'README.md')));
  const claudeRow = review.json.rows.find((r) => r.file === '~/.claude/CLAUDE.md');
  assert.match(readFileSync(join(review.json.dir, `${claudeRow.stem}.before.md`), 'utf8'), /^# Global Claude Code Instructions/);
  assert.match(readFileSync(join(review.json.dir, `${claudeRow.stem}.after.md`), 'utf8'), /generated by instructions-global/);
  assert.match(readFileSync(join(review.json.dir, `${claudeRow.stem}.diff`), 'utf8'), /^--- ~\/.claude\/CLAUDE.md \(before\)/);

  const list = runScript(G, 'restore.js', ['--list'], { home });
  assert.equal(list.json.runs.length, 1);
  const res = runScript(G, 'restore.js', ['--run', runId, '--path', join(home, '.claude', 'CLAUDE.md')], { home });
  assert.equal(res.code, 0, res.stderr);
  assert.match(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), /^# Global Claude Code Instructions/);
});

test('global apply refuses a repository path and a symlinked target without the flag', async () => {
  const root = tmp();
  const home = homeBloated(root, { withSymlink: platform() !== 'win32' });
  const inv = runScript(G, 'inventory.js', ['--new-run'], { home });
  const runId = inv.json.runId;
  const runDir = join(home, '.agent-instructions', 'runs', runId);
  const outside = join(root, 'some-repo', 'AGENTS.md');
  mkdirSync(join(root, 'some-repo'), { recursive: true });
  writeFileSync(join(runDir, 'x.md'), 'x\n');
  writeFileSync(join(runDir, 'plan.json'), JSON.stringify({ runId, skill: 'instructions-global', actions: [{ action: 'write', path: outside, from: join(runDir, 'x.md') }] }));
  const r = runScript(G, 'apply.js', ['--run', runId], { home });
  assert.equal(r.code, 3);
  assert.match(r.json.error, /outside the allowed roots/);
  assert.ok(!existsSync(outside));
  if (platform() !== 'win32') assert.ok(inv.json.warnings.some((w) => /AGENTS\.override\.md/.test(w)));
});

test('global: disabled surface, CODEX_HOME override, karpathy skill doubling, custom instruction dirs', async () => {
  const root = tmp();
  const home = homeBloated(root);
  mkdirSync(join(home, '.agent-instructions'), { recursive: true });
  writeFileSync(join(home, '.agent-instructions', 'config.json'), JSON.stringify({ disabled_surfaces: ['copilot-cli'] }));
  const codexHome = join(root, 'codex-home');
  mkdirSync(join(codexHome, 'skills', 'karpathy-guidelines'), { recursive: true });
  const inv = runScript(G, 'inventory.js', [], { home, env: { CODEX_HOME: codexHome, COPILOT_CUSTOM_INSTRUCTIONS_DIRS: '/tmp/extra' } });
  assert.equal(inv.code, 0, inv.stderr);
  const codex = inv.json.surfaces.find((s) => s.id === 'codex');
  assert.equal(codex.configDir, codexHome);
  assert.equal(inv.json.surfaces.find((s) => s.id === 'copilot-cli').disabled, true);
  assert.ok(inv.json.warnings.some((w) => /installed as a skill/.test(w)));
  assert.ok(inv.json.warnings.some((w) => /COPILOT_CUSTOM_INSTRUCTIONS_DIRS/.test(w)));
});

// --- project scripts end to end ----------------------------------------------

test('project gate: solo → personal, team → stop without --shared-ok, no git → stop', () => {
  const root = tmp();
  const home = join(root, 'home');
  mkdirSync(home);
  const solo = repoSolo(root);
  const team = repoTeam(root);
  const nogit = dirNoGit(root);
  let r = runScript(P, 'gate.js', [], { home, cwd: solo });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.verdict, 'personal');
  r = runScript(P, 'gate.js', [], { home, cwd: team });
  assert.equal(r.code, 2);
  assert.equal(r.json.verdict, 'shared');
  assert.ok(r.json.reasons.some((x) => /other author/.test(x)));
  assert.ok(r.json.reasons.some((x) => /CODEOWNERS/.test(x)));
  r = runScript(P, 'gate.js', ['--shared-ok'], { home, cwd: team });
  assert.equal(r.code, 0);
  r = runScript(P, 'gate.js', ['--status'], { home, cwd: team });
  assert.equal(r.code, 0, 'status is read-only, the shared verdict is advisory');
  assert.equal(r.json.verdict, 'shared');
  r = runScript(P, 'gate.js', [], { home, cwd: nogit });
  assert.equal(r.code, 2);
  assert.equal(r.json.git, false);
  r = runScript(P, 'gate.js', ['--plain-dir'], { home, cwd: nogit });
  assert.equal(r.code, 0);
  // config.git_emails makes the other author "me"
  mkdirSync(join(home, '.agent-instructions'), { recursive: true });
  writeFileSync(join(home, '.agent-instructions', 'config.json'), JSON.stringify({ git_emails: ['other@example.com'] }));
  r = runScript(P, 'gate.js', [], { home, cwd: team });
  assert.equal(r.json.reasons.length, 1, 'only CODEOWNERS remains');
});

test('project flow: solo repo with root CLAUDE.md → AGENTS.md + shim, archive, drift, sync', () => {
  const root = tmp();
  const home = join(root, 'home');
  mkdirSync(home);
  const repo = repoSolo(root);
  const inv = runScript(P, 'inventory.js', ['--new-run'], { home, cwd: repo });
  assert.equal(inv.code, 0, inv.stderr);
  const runId = inv.json.runId;
  assert.equal(inv.json.files.claudeRoot.exists, true);
  assert.equal(inv.json.shim.state, 'absent');
  assert.ok(inv.json.warnings.some((w) => /never run/.test(w)));

  const agents = join(root, 'agents.md');
  writeFileSync(agents, '# solo\n\n## Commands\n- Always run `npm test` after modifying JavaScript files.\n\n## Conventions\n- This repo uses npm; do not use pnpm.\n');
  const claudeOnly = join(root, 'claude-only.md');
  writeFileSync(claudeOnly, 'Use the Claude `/review` command before opening a PR.\n');
  const ren = runScript(P, 'render.js', ['--run', runId, '--agents-from', agents, '--claude-only', claudeOnly], { home, cwd: repo });
  assert.equal(ren.code, 0, ren.stderr);
  const plan = JSON.parse(readFileSync(ren.json.plan, 'utf8'));
  assert.deepEqual(plan.actions.map((a) => a.action), ['write', 'write', 'move']);
  assert.equal(plan.actions[2].path, join(repo, 'CLAUDE.md'));

  const app = runScript(P, 'apply.js', ['--run', runId], { home, cwd: repo });
  assert.equal(app.code, 0, app.stderr);
  assert.ok(!existsSync(join(repo, 'CLAUDE.md')));
  const shim = readFileSync(join(repo, '.claude', 'CLAUDE.md'), 'utf8');
  assert.match(shim, /^<!-- instructions-project: shim; canonical AGENTS\.md sha256 [0-9a-f]{64} -->\n@AGENTS\.md\n\nUse the Claude/);
  assert.ok(existsSync(join(home, '.agent-instructions', 'archive', runId, 'repo', 'repo-solo', 'CLAUDE.md')));
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });
  assert.match(status, /D CLAUDE\.md/);
  assert.match(status, /\?\? AGENTS\.md/);
  assert.equal(execFileSync('git', ['log', '--oneline'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').length, 1, 'no commit was made');

  let drift = runScript(P, 'drift.js', [], { home, cwd: repo });
  assert.equal(drift.json.anyChange, false);
  writeFileSync(join(repo, 'AGENTS.md'), readFileSync(join(repo, 'AGENTS.md'), 'utf8') + '- new rule\n');
  drift = runScript(P, 'drift.js', ['--diff'], { home, cwd: repo });
  assert.equal(drift.json.files[0].state, 'agents-moved');
  assert.match(drift.json.files[0].diff, /sha256/);
  const inv2 = runScript(P, 'inventory.js', ['--new-run'], { home, cwd: repo });
  assert.equal(inv2.json.shim.state, 'drift');
  // --sync-only equivalent: render from the current AGENTS.md; only the shim changes
  const ren2 = runScript(P, 'render.js', ['--run', inv2.json.runId], { home, cwd: repo });
  assert.equal(ren2.json.actions, 1);
  assert.equal(JSON.parse(readFileSync(ren2.json.plan, 'utf8')).actions[0].path, join(repo, '.claude', 'CLAUDE.md'));
  const rep = runScript(P, 'report.js', ['--run', runId], { home, cwd: repo });
  assert.match(rep.json.markdown, /\| AGENTS\.md \| create/);
});

test('project: mixed repo inventory (nested, rules, override, .vscode), copilot copy, memory promotion, apply refuses home files', () => {
  const root = tmp();
  const home = join(root, 'home');
  const repo = repoMixed(root);
  const memDir = join(home, '.claude', 'projects', repo.replace(/[\\/:]+/g, '-'), 'memory');
  mkdirSync(memDir, { recursive: true });
  writeFileSync(join(memDir, 'MEMORY.md'), '- [Tests](tests.md) — tests\n');
  writeFileSync(join(memDir, 'tests.md'), '---\nname: tests\n---\n\nTests: `pytest -q`; DB tests need `docker compose up db`.\nUse /opt/homebrew/bin/python3.11 for scripts.\n');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'CLAUDE.md'), 'global\n');

  const inv = runScript(P, 'inventory.js', ['--new-run'], { home, cwd: repo });
  assert.equal(inv.code, 0, inv.stderr);
  assert.deepEqual(inv.json.nested.agents, ['packages/api/AGENTS.md']);
  assert.deepEqual(inv.json.nested.claudeRules, ['.claude/rules/ts.md']);
  assert.deepEqual(inv.json.nested.copilotInstructions, ['.github/instructions/docs.instructions.md']);
  assert.equal(inv.json.files.agentsOverride.exists, true);
  assert.ok(inv.json.warnings.some((w) => /AGENTS\.override\.md/.test(w)));
  assert.equal(inv.json.vscode[0].values['chat.useClaudeMdFile'], true);
  assert.equal(inv.json.memory.exists, true);
  assert.equal(inv.json.copilotCopy.generated, false);

  const runId = inv.json.runId;
  const agents = join(root, 'agents.md');
  writeFileSync(agents, '# mixed\n\n## Commands\n- Tests: `npm test`\n- Run `npm run lint` before committing.\n- DB tests need `docker compose up db`.\n\n## Conventions\n- Use npm, never pnpm.\n\n## Safety\n- Never commit secrets.\n');
  const memNew = join(root, 'tests-new.md');
  writeFileSync(memNew, '---\nname: tests\n---\n\nUse /opt/homebrew/bin/python3.11 for scripts.\n');
  const edits = join(root, 'edits.json');
  writeFileSync(edits, JSON.stringify({ [join(memDir, 'tests.md')]: memNew }));
  const ren = runScript(P, 'render.js', ['--run', runId, '--agents-from', agents, '--copilot-copy', '--memory-edits', edits], { home, cwd: repo });
  assert.equal(ren.code, 0, ren.stderr);
  const plan = JSON.parse(readFileSync(ren.json.plan, 'utf8'));
  const byTarget = Object.fromEntries(plan.actions.map((a) => [a.target ?? a.path, a]));
  assert.ok(byTarget['copilot-instructions.md'], 'copilot copy rendered');
  assert.ok(byTarget['memory-tests.md'], 'memory edit staged');
  assert.ok(plan.actions.some((a) => a.action === 'move' && a.path === join(repo, 'CLAUDE.md')));

  const app = runScript(P, 'apply.js', ['--run', runId], { home, cwd: repo });
  assert.equal(app.code, 0, app.stderr);
  assert.match(readFileSync(join(repo, '.github', 'copilot-instructions.md'), 'utf8'), /^<!-- generated by instructions-project from AGENTS\.md/);
  assert.match(readFileSync(join(memDir, 'tests.md'), 'utf8'), /^---\nname: tests\n---/);
  assert.doesNotMatch(readFileSync(join(memDir, 'tests.md'), 'utf8'), /pytest/);
  const drift = runScript(P, 'drift.js', [], { home, cwd: repo });
  assert.ok(drift.json.files.every((f) => f.state === 'in-sync'), JSON.stringify(drift.json.files));

  // a plan that touches a home instruction file is refused
  const inv2 = runScript(P, 'inventory.js', ['--new-run'], { home, cwd: repo });
  const runDir = join(home, '.agent-instructions', 'runs', inv2.json.runId);
  writeFileSync(join(runDir, 'x.md'), 'x\n');
  writeFileSync(join(runDir, 'plan.json'), JSON.stringify({ runId: inv2.json.runId, skill: 'instructions-project', root: repo, actions: [{ action: 'write', path: join(home, '.claude', 'CLAUDE.md'), from: join(runDir, 'x.md') }] }));
  const refused = runScript(P, 'apply.js', ['--run', inv2.json.runId], { home, cwd: repo });
  assert.equal(refused.code, 3);
  assert.equal(readFileSync(join(home, '.claude', 'CLAUDE.md'), 'utf8'), 'global\n');
});

test('project: team repo inventory still works read-only; fixtures build all scenarios', () => {
  const root = tmp();
  const built = buildAll(root);
  assert.deepEqual(Object.keys(built).sort(), ['dir-nogit', 'home-bloated', 'home-minimal', 'repo-mixed', 'repo-solo', 'repo-team']);
  const home = built['home-minimal'];
  const inv = runScript(P, 'inventory.js', [], { home, cwd: built['repo-team'] });
  assert.equal(inv.code, 0, inv.stderr);
  assert.equal(inv.json.gate.verdict, 'shared');
  assert.ok(readdirSync(built['repo-team']).includes('AGENTS.md'));
});
