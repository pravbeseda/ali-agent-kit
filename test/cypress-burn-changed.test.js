import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { delimiter, join } from 'node:path';
import { packageRoot } from '../src/config.js';

const SKILL = join(packageRoot, 'skills', 'cypress-burn-changed');
const SCRIPT = 'burn-changed-tests.mjs';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'ali-burn-')));

// Stands in for the real script: it imports a sibling that only the target
// project has, records how it was started, then behaves as FAKE_MODE says.
const FAKE_SCRIPT = `
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { helper } from './helper.mjs';

fs.writeFileSync(process.env.FAKE_REPORT, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  self: fileURLToPath(import.meta.url),
  helper,
  pid: process.pid
}));

const mode = process.env.FAKE_MODE;
if (mode === 'fail') process.exit(1);
if (mode === 'crash') throw new Error('boom');
if (mode === 'hang') setInterval(() => {}, 1000);
`;

/** The skill as installed: run.mjs from the repo, next to the fake script. */
function fakeSkill() {
  const dir = join(tmp(), 'skill');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(join(SKILL, 'scripts', 'run.mjs'), join(dir, 'scripts', 'run.mjs'));
  writeFileSync(join(dir, 'scripts', SCRIPT), FAKE_SCRIPT);
  return dir;
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
}

/** A committed repository with `testing/Cypress/scripts/helper.mjs`. */
function project({ withScriptsDir = true } = {}) {
  const root = tmp();
  git(root, ['init', '-q']);
  if (withScriptsDir) {
    mkdirSync(join(root, 'testing', 'Cypress', 'scripts'), { recursive: true });
    writeFileSync(join(root, 'testing', 'Cypress', 'scripts', 'helper.mjs'), "export const helper = 'from the project';\n");
  } else {
    writeFileSync(join(root, 'README.md'), 'no cypress here\n');
  }
  git(root, ['add', '.']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

const scriptsDir = (root) => join(root, 'testing', 'Cypress', 'scripts');
const copied = (root) => join(scriptsDir(root), SCRIPT);

function env(report, mode) {
  return { ...process.env, FAKE_REPORT: report, FAKE_MODE: mode ?? '', GIT_CEILING_DIRECTORIES: [tmpdir(), realpathSync(tmpdir())].join(delimiter) };
}

function run(skill, cwd, args = [], { mode } = {}) {
  const report = join(tmp(), 'report.json');
  const r = spawnSync(process.execPath, [join(skill, 'scripts', 'run.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
    env: env(report, mode)
  });
  const ran = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ran };
}

const status = (root) => git(root, ['status', '--porcelain', '--untracked-files=all']);

test('outside a git repository it stops and creates nothing', () => {
  const skill = fakeSkill();
  const cwd = tmp();

  const r = run(skill, cwd, ['--dry-run']);

  assert.equal(r.code, 2);
  assert.match(r.stderr, /not inside a git repository/);
  assert.equal(r.ran, null);
  assert.deepEqual(readdirSync(cwd), []);
  assert.deepEqual(readdirSync(join(skill, 'scripts')).sort(), ['burn-changed-tests.mjs', 'run.mjs']);
});

test('in a repository without testing/Cypress/scripts it stops and creates nothing', () => {
  const skill = fakeSkill();
  const root = project({ withScriptsDir: false });

  const r = run(skill, root, ['--dry-run']);

  assert.equal(r.code, 2);
  assert.match(r.stderr, /testing\/Cypress\/scripts/);
  assert.equal(r.ran, null);
  assert.equal(existsSync(join(root, 'testing')), false);
  assert.equal(status(root), '');
});

test('a burn-changed-tests.mjs already in the project is left alone', () => {
  const skill = fakeSkill();
  const root = project();
  writeFileSync(copied(root), '// the project adopted the script\n');

  const r = run(skill, root, ['--dry-run']);

  assert.equal(r.code, 2);
  assert.match(r.stderr, /already exists/);
  assert.equal(r.ran, null);
  assert.equal(readFileSync(copied(root), 'utf8'), '// the project adopted the script\n');
});

test('runs the copy from testing/Cypress with the flags passed through, then removes it', () => {
  const skill = fakeSkill();
  const root = project();
  const args = ['--burn', '3', '--only', 'a title, with a comma', '--dry-run'];

  const r = run(skill, root, args);

  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.ran.argv, args);
  assert.equal(r.ran.cwd, join(root, 'testing', 'Cypress'));
  assert.equal(r.ran.self, copied(root));
  assert.equal(r.ran.helper, 'from the project');
  assert.equal(existsSync(copied(root)), false);
  assert.equal(status(root), '');
});

test('finds the project from any directory of the repository', () => {
  const skill = fakeSkill();
  const root = project();

  const r = run(skill, scriptsDir(root));

  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.ran.cwd, join(root, 'testing', 'Cypress'));
  assert.equal(status(root), '');
});

test('a run with failing tests keeps exit code 1 and still removes the copy', () => {
  const skill = fakeSkill();
  const root = project();

  const r = run(skill, root, [], { mode: 'fail' });

  assert.equal(r.code, 1);
  assert.ok(r.ran);
  assert.equal(status(root), '');
});

test('a crashing script still has its copy removed', () => {
  const skill = fakeSkill();
  const root = project();

  const r = run(skill, root, [], { mode: 'crash' });

  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /boom/);
  assert.equal(status(root), '');
});

/**
 * Start a hanging run, wait until the script is up, call `during` while it
 * runs, then deliver `signal`.
 */
async function interrupt(signal, { group, during = () => null }) {
  const skill = fakeSkill();
  const root = project();
  const report = join(tmp(), 'report.json');
  const child = spawn(process.execPath, [join(skill, 'scripts', 'run.mjs')], {
    cwd: root,
    env: env(report, 'hang'),
    stdio: 'ignore',
    detached: group
  });
  const exited = new Promise((resolve) => child.on('exit', (code, sig) => resolve({ code, sig })));

  const deadline = Date.now() + 10_000;
  while (!existsSync(report) || !readFileSync(report, 'utf8')) {
    assert.ok(Date.now() < deadline, 'the script never started');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const { pid } = JSON.parse(readFileSync(report, 'utf8'));
  const meanwhile = during(skill, root);

  // A terminal's Ctrl-C reaches the whole process group; `kill <pid>` only the wrapper.
  process.kill(group ? -child.pid : child.pid, signal);
  const result = await exited;

  const alive = (() => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  })();
  return { ...result, skill, root, pid, alive, meanwhile };
}

const posixOnly = { skip: platform() === 'win32' && 'POSIX signals' };

test('Ctrl-C on the process group removes the copy', posixOnly, async () => {
  const r = await interrupt('SIGINT', { group: true });

  assert.equal(r.code, 130);
  assert.equal(r.alive, false);
  assert.equal(status(r.root), '');
});

test('SIGTERM to the wrapper alone stops the script and removes the copy', posixOnly, async () => {
  const r = await interrupt('SIGTERM', { group: false });

  assert.equal(r.code, 143);
  assert.equal(r.alive, false);
  assert.equal(status(r.root), '');
});

test('a hangup, as from a closed terminal, stops the script and removes the copy', posixOnly, async () => {
  const r = await interrupt('SIGHUP', { group: false });

  assert.equal(r.code, 129);
  assert.equal(r.alive, false);
  assert.equal(status(r.root), '');
});

test('a second run while the first is still going names the copy as ours', posixOnly, async () => {
  const r = await interrupt('SIGTERM', { group: false, during: (skill, root) => run(skill, root, ['--dry-run']) });

  assert.equal(r.meanwhile.code, 2);
  assert.match(r.meanwhile.stderr, /left there by this skill/);
  assert.equal(r.meanwhile.ran, null);
  assert.equal(r.code, 143);
  assert.equal(status(r.root), '');
});

test('a copy left by a killed run is named as ours and left in place', posixOnly, async () => {
  const killed = await interrupt('SIGKILL', { group: false });
  process.kill(killed.pid, 'SIGKILL');
  assert.equal(existsSync(copied(killed.root)), true, 'SIGKILL is the one exit nothing can clean up after');
  const leftover = readFileSync(copied(killed.root));

  const r = run(killed.skill, killed.root, ['--dry-run']);

  assert.equal(r.code, 2);
  assert.match(r.stderr, /left there by this skill/);
  assert.match(r.stderr, /delete it/);
  assert.equal(r.ran, null);
  assert.deepEqual(readFileSync(copied(killed.root)), leftover);
});
