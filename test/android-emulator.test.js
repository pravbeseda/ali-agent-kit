import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageRoot } from '../src/config.js';
import { decide, parseProcesses, readAvdState, tryLock, unlock } from '../skills/android-emulator/scripts/lib.mjs';

const SCRIPTS = join(packageRoot, 'skills', 'android-emulator', 'scripts');
const MIN = 60_000;
const IDLE = 20 * MIN;
const NOW = 1_000 * MIN;
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'ali-emulator-')));

const headless = { avd: 'test26', headless: true };
const windowed = { avd: 'Medium_Phone', headless: false };
const alive = (pids) => (pid) => pids.includes(pid);
const state = (fields) => ({ leases: [], lastUsed: null, firstSeen: null, ...fields });

test('an emulator nobody has seen before starts its idle clock', () => {
  assert.deepEqual(decide({ emulator: headless, state: null, isAlive: alive([]), now: NOW, idleMs: IDLE }), {
    dead: [],
    verdict: 'mark-seen'
  });
});

test('a live lease keeps the emulator however long it has been idle', () => {
  const s = state({ leases: [11], lastUsed: NOW - 10 * IDLE });
  assert.equal(decide({ emulator: headless, state: s, isAlive: alive([11]), now: NOW, idleMs: IDLE }).verdict, 'keep');
});

test('dead leases are dropped and do not count as holders', () => {
  const s = state({ leases: [11, 12], lastUsed: NOW - IDLE });
  assert.deepEqual(decide({ emulator: headless, state: s, isAlive: alive([12]), now: NOW, idleMs: IDLE }), {
    dead: [11],
    verdict: 'keep'
  });
  assert.deepEqual(decide({ emulator: headless, state: s, isAlive: alive([]), now: NOW, idleMs: IDLE }), {
    dead: [11, 12],
    verdict: 'kill'
  });
});

test('an unleased emulator is killed only once the idle timeout has passed', () => {
  const at = (lastUsed) => decide({ emulator: headless, state: state({ lastUsed }), isAlive: alive([]), now: NOW, idleMs: IDLE }).verdict;
  assert.equal(at(NOW - IDLE + 1), 'keep');
  assert.equal(at(NOW - IDLE), 'kill');
});

test('the idle clock runs from the later of first sighting and last use', () => {
  const s = state({ firstSeen: NOW - 2 * IDLE, lastUsed: NOW - MIN });
  assert.equal(decide({ emulator: headless, state: s, isAlive: alive([]), now: NOW, idleMs: IDLE }).verdict, 'keep');
  const seenOnly = state({ firstSeen: NOW - IDLE });
  assert.equal(decide({ emulator: headless, state: seenOnly, isAlive: alive([]), now: NOW, idleMs: IDLE }).verdict, 'kill');
});

test('a windowed emulator is never killed and never starts a clock', () => {
  assert.equal(decide({ emulator: windowed, state: null, isAlive: alive([]), now: NOW, idleMs: IDLE }).verdict, 'keep');
  const s = state({ leases: [11], lastUsed: NOW - 10 * IDLE });
  assert.deepEqual(decide({ emulator: windowed, state: s, isAlive: alive([]), now: NOW, idleMs: IDLE }), {
    dead: [11],
    verdict: 'keep'
  });
});

test('the state of an emulator that is gone is forgotten unless a wrapper still holds it', () => {
  const s = state({ leases: [11], lastUsed: NOW - IDLE });
  assert.deepEqual(decide({ emulator: null, state: s, isAlive: alive([]), now: NOW, idleMs: IDLE }), {
    dead: [11],
    verdict: 'forget'
  });
  // A wrapper that is still booting it: its lease is there before the process is.
  assert.equal(decide({ emulator: null, state: s, isAlive: alive([11]), now: NOW, idleMs: IDLE }).verdict, 'keep');
});

test('emulator processes are read from ps output, headless told apart by the binary name', () => {
  const ps = [
    '  501 /usr/bin/login -pf ai',
    '12954 /Users/ai/Library/Android/sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64-headless -avd test26 -no-snapshot-save -no-window',
    '42970 /Users/ai/Library/Android/sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd Medium_Phone_API_36.0 -no-snapshot-save',
    '  777 grep qemu-system',
    ''
  ].join('\n');
  assert.deepEqual(parseProcesses(ps), [
    { pid: 12954, avd: 'test26', headless: true },
    { pid: 42970, avd: 'Medium_Phone_API_36.0', headless: false }
  ]);
});

test('the state of one AVD is read from its directory', () => {
  const dir = join(tmp(), 'test26');
  mkdirSync(join(dir, 'leases'), { recursive: true });
  writeFileSync(join(dir, 'leases', '11'), '');
  writeFileSync(join(dir, 'leases', '12'), '');
  writeFileSync(join(dir, 'last-used'), '123\n');
  assert.deepEqual(readAvdState(dir), { leases: [11, 12], lastUsed: 123, firstSeen: null });
  assert.equal(readAvdState(join(tmp(), 'missing')), null);
});

test('a lock is exclusive, and one left by a dead process is taken over', () => {
  const dir = join(tmp(), 'test26');
  assert.equal(tryLock(dir), true);
  assert.equal(tryLock(dir), false, 'the holder is alive: this process');
  unlock(dir);
  assert.equal(existsSync(join(dir, 'lock')), false);

  mkdirSync(join(dir, 'lock'));
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout;
  writeFileSync(join(dir, 'lock', 'pid'), dead);
  assert.equal(tryLock(dir), true);
  assert.equal(readFileSync(join(dir, 'lock', 'pid'), 'utf8'), String(process.pid));
});

test('with-emulator refuses malformed arguments before touching anything', () => {
  const state = tmp();
  const run = (args) =>
    spawnSync(process.execPath, [join(SCRIPTS, 'with-emulator.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, ALI_EMULATOR_STATE: state }
    });
  for (const args of [[], ['test26'], ['test26', '--'], ['bad/name', '--', 'true'], ['test26', 'true']]) {
    const r = run(args);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stderr}`);
    assert.match(r.stderr, /usage: /);
  }
  assert.equal(existsSync(join(state, 'test26')), false);
});
