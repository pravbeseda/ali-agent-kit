import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageRoot } from '../src/config.js';
import { loadSkills } from '../src/skills.js';

const CLI = join(packageRoot, 'bin/cli.js');

// The CLI always installs from the package's own `skills/`, so these tests
// cannot supply fixtures the way install.test.js does. They take the names
// they need from the source instead of hardcoding shipped ones.
const shipped = loadSkills().map((skill) => skill.name);

/** Run the CLI against a throwaway HOME so no real agent is touched. */
function run(args, { home = mkdtempSync(join(tmpdir(), 'ali-cli-')), env = {} } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, USERPROFILE: home, ...env }
  });
  return { ...result, home, output: `${result.stdout}${result.stderr}` };
}

test('help exits 0 and lists the agents', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /ali-agent-kit install/);
  assert.match(stdout, /claude-code \| claude/);
});

test('an unknown agent exits 1 with a message, not a stack trace', () => {
  const { status, output } = run(['install', '--agent', 'nope']);
  assert.equal(status, 1);
  assert.match(output, /Unknown agent "nope"/);
  assert.doesNotMatch(output, /at .*install\.js/, 'no stack trace for a user error');
});

test('an unknown command exits 1', () => {
  assert.equal(run(['frobnicate']).status, 1);
});

test('install into a home with no agents exits 0 and writes nothing', () => {
  const { status, stdout } = run(['install']);
  assert.equal(status, 0);
  assert.match(stdout, /No supported agent found/);
});

test('a conflict makes install exit 2 while still installing the rest', () => {
  const [blocked, untouched] = shipped;
  assert.ok(untouched, 'this case needs at least two source skills');

  const home = mkdtempSync(join(tmpdir(), 'ali-cli-'));
  const skillsDir = join(home, '.claude/skills');
  mkdirSync(join(skillsDir, blocked), { recursive: true });
  writeFileSync(join(skillsDir, blocked, 'SKILL.md'), 'not ours\n');

  const { status, stdout } = run(['install'], { home });

  assert.equal(status, 2);
  assert.match(stdout, /is not owned by ali-agent-kit/);
  assert.ok(stdout.includes(`+ ${untouched}`), 'other skills still install');
});

test('dry run reports the plan and leaves the exit code intact', () => {
  const home = mkdtempSync(join(tmpdir(), 'ali-cli-'));
  mkdirSync(join(home, '.codex'), { recursive: true });

  const { status, stdout } = run(['install', '--agent', 'codex', '--dry-run'], { home });

  assert.equal(status, 0);
  assert.match(stdout, /\(dry run\)/);
  assert.match(stdout, /\+ ali-\S+/, 'the plan names the skills it would write');
});

test('validate passes for the shipped skills', () => {
  const { status, stdout } = run(['validate']);
  assert.equal(status, 0);
  assert.match(stdout, /skill\(s\) valid/);
});
