import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync, uninstall, detectAgents, installedSkills } from '../src/install.js';
import { loadSkills } from '../src/skills.js';
import { MARKER, MARKER_SCHEMA_VERSION } from '../src/config.js';
import { adapters, resolveAdapters } from '../src/adapters/index.js';

/** Fake home with only the named agents present. */
function fakeHome(agents = ['claude']) {
  const home = mkdtempSync(join(tmpdir(), 'ali-home-'));
  const dirs = { claude: '.claude', copilot: '.copilot', codex: '.codex' };
  for (const id of agents) mkdirSync(join(home, dirs[id]), { recursive: true });
  return home;
}

function sourceSkills(defs) {
  const dir = mkdtempSync(join(tmpdir(), 'ali-src-'));
  for (const [name, description] of Object.entries(defs)) {
    writeFileSync(join(dir, `${name}.md`), `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`);
  }
  return loadSkills(dir);
}

const env = {};

test('installs only into agents that exist', () => {
  const home = fakeHome(['claude', 'codex']);
  const result = sync({ skills: sourceSkills({ one: 'first' }), home, env });

  assert.deepEqual(result.agents.map((a) => a.adapter.id).sort(), ['claude-code', 'codex']);
  assert.deepEqual(result.skipped.map((a) => a.adapter.id), ['copilot']);
  assert.ok(existsSync(join(home, '.claude/skills/ali-one/SKILL.md')));
  assert.ok(existsSync(join(home, '.codex/skills/ali-one/SKILL.md')));
  assert.ok(!existsSync(join(home, '.copilot')));
});

test('installed skill carries the ownership marker', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'first' }), home, env });

  const marker = JSON.parse(readFileSync(join(home, '.claude/skills/ali-one', MARKER), 'utf8'));
  assert.equal(marker.packageName, 'ali-agent-kit');
  assert.equal(marker.schemaVersion, MARKER_SCHEMA_VERSION);
  assert.equal(marker.installedName, 'ali-one');
  assert.equal(marker.sourceName, 'one');
});

test('second run updates instead of duplicating', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'first' }), home, env });
  const second = sync({ skills: sourceSkills({ one: 'first' }), home, env });

  assert.deepEqual(second.agents[0].added, []);
  assert.deepEqual(second.agents[0].updated, ['ali-one']);
});

test('an update replaces the previous content and leaves no staging dirs', () => {
  const home = fakeHome();
  const skillsDir = join(home, '.claude/skills');
  sync({ skills: sourceSkills({ one: 'first' }), home, env });
  writeFileSync(join(skillsDir, 'ali-one/stale.md'), 'from the old version');

  sync({ skills: sourceSkills({ one: 'second' }), home, env });

  assert.match(readFileSync(join(skillsDir, 'ali-one/SKILL.md'), 'utf8'), /description: second/);
  assert.ok(!existsSync(join(skillsDir, 'ali-one/stale.md')), 'old files must not survive');
  assert.deepEqual(readdirSync(skillsDir), ['ali-one'], 'no staging or backup leftovers');
});

test('skills deleted from the package are pruned on update', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'first', two: 'second' }), home, env });
  assert.deepEqual(installedSkills(join(home, '.claude/skills')), ['ali-one', 'ali-two']);

  const result = sync({ skills: sourceSkills({ one: 'first' }), home, env });
  assert.deepEqual(result.agents[0].removed, ['ali-two']);
  assert.ok(!existsSync(join(home, '.claude/skills/ali-two')));
  assert.ok(existsSync(join(home, '.claude/skills/ali-one')));
});

test('--no-prune keeps removed skills', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'a', two: 'b' }), home, env });
  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env, prune: false });

  assert.deepEqual(result.agents[0].removed, []);
  assert.ok(existsSync(join(home, '.claude/skills/ali-two')));
});

test('never prunes or overwrites unmanaged skills, but still installs the rest', () => {
  const home = fakeHome();
  const skillsDir = join(home, '.claude/skills');
  mkdirSync(join(skillsDir, 'ali-one'), { recursive: true });
  writeFileSync(join(skillsDir, 'ali-one/SKILL.md'), 'mine, hands off\n');
  mkdirSync(join(skillsDir, 'my-own'), { recursive: true });
  writeFileSync(join(skillsDir, 'my-own/SKILL.md'), 'mine too\n');

  const result = sync({ skills: sourceSkills({ one: 'a', two: 'b' }), home, env });

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.agents[0].conflicts[0].name, 'ali-one');
  assert.equal(readFileSync(join(skillsDir, 'ali-one/SKILL.md'), 'utf8'), 'mine, hands off\n');
  assert.ok(existsSync(join(skillsDir, 'my-own/SKILL.md')));
  assert.ok(existsSync(join(skillsDir, 'ali-two/SKILL.md')), 'a conflict must not block other skills');
});

test('a symlinked skill directory counts as a conflict', () => {
  const home = fakeHome();
  const skillsDir = join(home, '.claude/skills');
  const elsewhere = mkdtempSync(join(tmpdir(), 'ali-other-'));
  mkdirSync(skillsDir, { recursive: true });
  symlinkSync(elsewhere, join(skillsDir, 'ali-one'));

  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env });
  assert.equal(result.conflicts[0].name, 'ali-one');
  assert.equal(readdirSync(elsewhere).length, 0);
});

test('a conflict in one agent does not block another agent', () => {
  const home = fakeHome(['claude', 'codex']);
  const claudeSkills = join(home, '.claude/skills');
  mkdirSync(join(claudeSkills, 'ali-one'), { recursive: true });
  writeFileSync(join(claudeSkills, 'ali-one/SKILL.md'), 'not ours\n');

  sync({ skills: sourceSkills({ one: 'a' }), home, env });
  assert.ok(existsSync(join(home, '.codex/skills/ali-one/SKILL.md')));
});

test('dry run writes nothing but reports the plan', () => {
  const home = fakeHome();
  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env, dryRun: true });

  assert.deepEqual(result.agents[0].added, ['ali-one']);
  assert.ok(!existsSync(join(home, '.claude/skills/ali-one')));
});

test('--agent limits the target and accepts aliases', () => {
  const home = fakeHome(['claude', 'codex']);
  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env, only: ['claude'] });

  assert.deepEqual(result.agents.map((a) => a.adapter.id), ['claude-code']);
  assert.ok(!existsSync(join(home, '.codex/skills/ali-one')));
});

test('agent selection resolves aliases, "all" and rejects unknown ids', () => {
  assert.deepEqual(resolveAdapters(['claude']).map((a) => a.id), ['claude-code']);
  assert.deepEqual(resolveAdapters(['claude', 'claude-code']).map((a) => a.id), ['claude-code']);
  assert.equal(resolveAdapters(['all']).length, resolveAdapters([]).length);
  assert.throws(() => resolveAdapters(['nope']), /Unknown agent/);
  assert.throws(() => resolveAdapters(['all', 'codex']), /on its own/);
});

test('uninstall removes managed skills only', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'a' }), home, env });
  mkdirSync(join(home, '.claude/skills/other'), { recursive: true });

  const result = uninstall({ home, env });
  assert.deepEqual(result.agents[0].removed, ['ali-one']);
  assert.ok(!existsSync(join(home, '.claude/skills/ali-one')));
  assert.ok(existsSync(join(home, '.claude/skills/other')));
});

test('leftovers from another tool are neither swept nor restored', () => {
  const home = fakeHome();
  const skillsDir = join(home, '.claude/skills');
  sync({ skills: sourceSkills({ one: 'a' }), home, env });
  const nonce = '22222222-0000-4000-8000-000000000000';
  mkdirSync(join(skillsDir, `.other-tool.backup-${nonce}`), { recursive: true });
  writeFileSync(join(skillsDir, `.other-tool.backup-${nonce}/data`), 'not ours\n');

  sync({ skills: sourceSkills({ one: 'a' }), home, env });

  assert.ok(
    existsSync(join(skillsDir, `.other-tool.backup-${nonce}/data`)),
    'another tool’s temp dir must survive'
  );
  assert.ok(!existsSync(join(skillsDir, 'other-tool')), 'and must not be restored into a skill');
});

test('an older marker schema still counts as ours', () => {
  const home = fakeHome();
  const skillsDir = join(home, '.claude/skills');
  sync({ skills: sourceSkills({ one: 'a', two: 'b' }), home, env });

  for (const name of ['ali-one', 'ali-two']) {
    const marker = join(skillsDir, name, MARKER);
    const data = JSON.parse(readFileSync(marker, 'utf8'));
    delete data.schemaVersion; // pre-versioning marker
    if (name === 'ali-two') data.schemaVersion = MARKER_SCHEMA_VERSION - 1;
    writeFileSync(marker, JSON.stringify(data));
  }

  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env });

  assert.deepEqual(result.conflicts, [], 'an old install must update, not conflict');
  assert.deepEqual(result.agents[0].updated, ['ali-one']);
  assert.deepEqual(result.agents[0].removed, ['ali-two'], 'and must still be prunable');
});

test('a marker from a newer schema is not treated as ours', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'a' }), home, env });
  const marker = join(home, '.claude/skills/ali-one', MARKER);
  writeFileSync(marker, JSON.stringify({ packageName: 'ali-agent-kit', schemaVersion: 999 }));

  assert.deepEqual(installedSkills(join(home, '.claude/skills')), []);
  const result = sync({ skills: sourceSkills({ two: 'b' }), home, env });
  assert.equal(result.conflicts.length, 0);
  assert.ok(existsSync(join(home, '.claude/skills/ali-one')), 'unknown schema is left alone, not pruned');
});

test('the executable bit of bundled scripts survives the install', () => {
  const home = fakeHome();
  const source = mkdtempSync(join(tmpdir(), 'ali-src-'));
  mkdirSync(join(source, 'scripted/scripts'), { recursive: true });
  writeFileSync(
    join(source, 'scripted/SKILL.md'),
    '---\nname: scripted\ndescription: Ships a script.\n---\nbody\n'
  );
  writeFileSync(join(source, 'scripted/scripts/run.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
  chmodSync(join(source, 'scripted/scripts/run.sh'), 0o755);

  sync({ skills: loadSkills(source), home, env });

  const installed = join(home, '.claude/skills/ali-scripted/scripts/run.sh');
  assert.equal(statSync(installed).mode & 0o111, 0o111, 'run.sh must stay executable');
  assert.equal(statSync(join(home, '.claude/skills/ali-scripted/SKILL.md')).mode & 0o111, 0);
});

/** Give one adapter a transform for the duration of a test. */
function withTransform(t, id, transform) {
  const adapter = adapters.find((a) => a.id === id);
  adapter.transform = transform;
  t.after(() => {
    delete adapter.transform;
  });
}

test('a renaming transform drives the plan, so nothing is pruned by mistake', (t) => {
  const home = fakeHome();
  withTransform(t, 'claude-code', (skill) => ({ ...skill, name: `${skill.name}-x` }));

  const first = sync({ skills: sourceSkills({ one: 'a' }), home, env, only: ['claude'] });
  assert.deepEqual(first.agents[0].added, ['ali-one-x']);
  assert.ok(existsSync(join(home, '.claude/skills/ali-one-x/SKILL.md')));

  const second = sync({ skills: sourceSkills({ one: 'a' }), home, env, only: ['claude'] });
  assert.deepEqual(second.agents[0].updated, ['ali-one-x'], 'the transformed name must be recognized');
  assert.deepEqual(second.agents[0].removed, [], 'the transformed skill must not be pruned');
  assert.ok(existsSync(join(home, '.claude/skills/ali-one-x/SKILL.md')));
});

test('a transform that breaks the contract fails loudly', (t) => {
  const home = fakeHome();
  withTransform(t, 'claude-code', (skill) => ({ ...skill, name: skill.name.replace('ali-', '') }));

  assert.throws(
    () => sync({ skills: sourceSkills({ one: 'a' }), home, env, only: ['claude'] }),
    /transform\(\) returned an invalid skill/
  );
});

test('a run killed mid-swap is repaired on the next install', () => {
  const home = fakeHome();
  const skillsDir = join(home, '.claude/skills');
  sync({ skills: sourceSkills({ one: 'a', two: 'b' }), home, env });

  // Simulate the crash window: destination moved aside, replacement never landed.
  const nonce = '00000000-0000-4000-8000-000000000000';
  renameSync(join(skillsDir, 'ali-one'), join(skillsDir, `.ali-one.backup-${nonce}`));
  mkdirSync(join(skillsDir, `.ali-two.staging-${nonce}`), { recursive: true });

  const result = sync({ skills: sourceSkills({ one: 'a', two: 'b' }), home, env });

  assert.deepEqual(result.agents[0].restored, ['ali-one']);
  assert.ok(existsSync(join(skillsDir, 'ali-one/SKILL.md')), 'the backup must come back');
  assert.deepEqual(readdirSync(skillsDir).sort(), ['ali-one', 'ali-two'], 'no leftovers remain');
});

test('a backup is dropped, not restored, when the destination is already there', () => {
  const home = fakeHome();
  const skillsDir = join(home, '.claude/skills');
  sync({ skills: sourceSkills({ one: 'a' }), home, env });
  const nonce = '11111111-0000-4000-8000-000000000000';
  mkdirSync(join(skillsDir, `.ali-one.backup-${nonce}`), { recursive: true });
  writeFileSync(join(skillsDir, `.ali-one.backup-${nonce}/SKILL.md`), 'stale copy\n');

  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env });

  assert.deepEqual(result.agents[0].restored, []);
  assert.deepEqual(readdirSync(skillsDir), ['ali-one']);
  assert.match(readFileSync(join(skillsDir, 'ali-one/SKILL.md'), 'utf8'), /description: a/);
});

test('env overrides relocate an agent config dir', () => {
  const home = fakeHome([]);
  const custom = mkdtempSync(join(tmpdir(), 'ali-codex-'));
  const { detected } = detectAgents({ home, env: { CODEX_HOME: custom }, only: ['codex'] });

  assert.equal(detected.length, 1);
  assert.equal(detected[0].skillsDir, join(custom, 'skills'));
});

test('a missing agent is reported once, with its default config dir', () => {
  const home = fakeHome([]);
  const { detected, skipped } = detectAgents({ home, env });

  assert.deepEqual(detected, []);
  assert.deepEqual(skipped.map((a) => a.adapter.id).sort(), ['claude-code', 'codex', 'copilot']);
  assert.equal(skipped[0].configDir, join(home, '.claude'));
});
