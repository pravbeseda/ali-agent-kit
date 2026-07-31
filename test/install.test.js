import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sync, uninstall, detectAgents, installedSkills } from '../src/install.js';
import { loadSkills } from '../src/skills.js';
import { MARKER } from '../src/config.js';

/** Fake home with only the agents named in `agents` present. */
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

  assert.deepEqual(result.agents.map((a) => a.adapter.id).sort(), ['claude', 'codex']);
  assert.deepEqual(result.skipped.map((a) => a.adapter.id), ['copilot']);
  assert.ok(existsSync(join(home, '.claude/skills/ali-one/SKILL.md')));
  assert.ok(existsSync(join(home, '.codex/skills/ali-one/SKILL.md')));
  assert.ok(!existsSync(join(home, '.copilot')));
});

test('installed skill carries the ownership marker', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'first' }), home, env });

  const marker = JSON.parse(readFileSync(join(home, '.claude/skills/ali-one', MARKER), 'utf8'));
  assert.equal(marker.package, 'ali-agent-kit');
  assert.equal(marker.skill, 'ali-one');
  assert.equal(marker.source, 'one');
});

test('second run updates instead of duplicating', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'first' }), home, env });
  const second = sync({ skills: sourceSkills({ one: 'first' }), home, env });

  assert.deepEqual(second.agents[0].added, []);
  assert.deepEqual(second.agents[0].updated, ['ali-one']);
});

test('skills deleted from the package are pruned on update', () => {
  const home = fakeHome();
  sync({ skills: sourceSkills({ one: 'first', two: 'second' }), home, env });
  assert.deepEqual(installedSkills(join(home, '.claude/skills')).sort(), ['ali-one', 'ali-two']);

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

test('never prunes or overwrites unmanaged skills', () => {
  const home = fakeHome();
  const skillsDir = join(home, '.claude/skills');
  mkdirSync(join(skillsDir, 'ali-one'), { recursive: true });
  writeFileSync(join(skillsDir, 'ali-one/SKILL.md'), 'mine, hands off\n');
  mkdirSync(join(skillsDir, 'my-own'), { recursive: true });
  writeFileSync(join(skillsDir, 'my-own/SKILL.md'), 'mine too\n');

  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env });

  assert.deepEqual(result.agents[0].conflicts, ['ali-one']);
  assert.equal(readFileSync(join(skillsDir, 'ali-one/SKILL.md'), 'utf8'), 'mine, hands off\n');
  assert.ok(existsSync(join(skillsDir, 'my-own/SKILL.md')));
});

test('dry run writes nothing but reports the plan', () => {
  const home = fakeHome();
  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env, dryRun: true });

  assert.deepEqual(result.agents[0].added, ['ali-one']);
  assert.ok(!existsSync(join(home, '.claude/skills/ali-one')));
});

test('--agent limits the target', () => {
  const home = fakeHome(['claude', 'codex']);
  const result = sync({ skills: sourceSkills({ one: 'a' }), home, env, only: ['codex'] });

  assert.deepEqual(result.agents.map((a) => a.adapter.id), ['codex']);
  assert.ok(!existsSync(join(home, '.claude/skills/ali-one')));
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

test('env overrides relocate an agent config dir', () => {
  const home = fakeHome([]);
  const custom = mkdtempSync(join(tmpdir(), 'ali-codex-'));
  const [codex] = detectAgents({ home, env: { CODEX_HOME: custom }, only: ['codex'] });

  assert.equal(codex.present, true);
  assert.equal(codex.skillsDir, join(custom, 'skills'));
});
