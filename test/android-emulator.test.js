import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageRoot } from '../src/config.js';
import { decide, parseProcesses, readAvdState, reaperSilent, runningEmulators, tryLock, unlock } from '../skills/android-emulator/scripts/lib.mjs';

const SCRIPTS = join(packageRoot, 'skills', 'android-emulator', 'scripts');
const LIB = join(SCRIPTS, 'lib.mjs');
const MIN = 60_000;
const IDLE = 20 * MIN;
const NOW = 1_000 * MIN;
const macOnly = { skip: platform() !== 'darwin' && 'the lock is an O_EXLOCK flock, macOS only' };
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

test('a reaper that never ran or missed three runs counts as not running', () => {
  assert.equal(reaperSilent(null, NOW), true);
  assert.equal(reaperSilent(NOW - 15 * MIN, NOW), false);
  assert.equal(reaperSilent(NOW - 15 * MIN - 1, NOW), true);
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

test('a lock is exclusive and released by unlock', macOnly, () => {
  const path = join(tmp(), 'state', 'test26.lock');
  const fd = tryLock(path);
  assert.notEqual(fd, null);
  assert.equal(tryLock(path), null);
  unlock(fd);
  const again = tryLock(path);
  assert.notEqual(again, null);
  unlock(again);
});

test('a lock dies with its holder, however it dies', macOnly, async () => {
  const path = join(tmp(), 'test26.lock');
  const holder = spawn(
    process.execPath,
    ['--input-type=module', '-e', `import { tryLock } from ${JSON.stringify(LIB)}; tryLock(${JSON.stringify(path)}); console.log('held'); setInterval(() => {}, 1000);`],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  const exited = once(holder, 'exit');
  try {
    await once(holder.stdout, 'data');
    assert.equal(tryLock(path), null);
  } finally {
    // A holder left alive would keep the suite from ever exiting.
    holder.kill('SIGKILL');
  }
  await exited;
  const fd = tryLock(path);
  assert.notEqual(fd, null);
  unlock(fd);
});

test('a process started under the lock does not keep it', macOnly, async () => {
  // The emulator is booted under the lock and outlives the wrapper.
  const path = join(tmp(), 'test26.lock');
  const fd = tryLock(path);
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  unlock(fd);
  const again = tryLock(path);
  child.kill();
  assert.notEqual(again, null);
  unlock(again);
});

test('with-emulator refuses malformed arguments before touching anything', () => {
  const state = tmp();
  const run = (args) =>
    spawnSync(process.execPath, [join(SCRIPTS, 'with-emulator.mjs'), ...args], {
      encoding: 'utf8',
      env: { ...process.env, ALI_EMULATOR_STATE: state }
    });
  for (const args of [[], ['test26'], ['test26', '--'], ['bad/name', '--', 'true'], ['..', '--', 'true'], ['.', '--', 'true'], ['.hidden', '--', 'true'], ['test26', 'true']]) {
    const r = run(args);
    assert.equal(r.status, 2, `${JSON.stringify(args)}: ${r.stderr}`);
    assert.match(r.stderr, /usage: /);
  }
  assert.equal(existsSync(join(state, 'test26')), false);
});

/**
 * An SDK whose emulator is a shell loop named like qemu, so `ps` sees it, and
 * whose adb answers for one booted emulator and logs every call.
 */
function fakeSdk(avd) {
  const sdk = tmp();
  const script = (path, body) => writeFileSync(join(sdk, path), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  mkdirSync(join(sdk, 'platform-tools'));
  mkdirSync(join(sdk, 'emulator'));
  script('emulator/qemu-system-aarch64-headless', 'while :; do sleep 1; done');
  script('emulator/qemu-system-aarch64', 'while :; do sleep 1; done');
  script('emulator/emulator', 'exec "$(dirname "$0")/qemu-system-aarch64-headless" "$@"');
  script(
    'platform-tools/adb',
    [
      `echo "$*" >> '${join(sdk, 'adb.log')}'`,
      'case "$*" in',
      `  devices) printf 'List of devices attached\\nemulator-5554\\tdevice\\n' ;;`,
      `  *"emu avd name") printf '${avd}\\r\\nOK\\r\\n' ;;`,
      '  *"getprop sys.boot_completed") echo 1 ;;',
      'esac'
    ].join('\n')
  );
  const env = { ...process.env, ANDROID_HOME: sdk, ALI_EMULATOR_STATE: join(sdk, 'state') };
  return {
    run: () => spawnSync(process.execPath, [join(SCRIPTS, 'with-emulator.mjs'), avd, '--', 'true'], { encoding: 'utf8', env }),
    startWindowed: () => spawn(join(sdk, 'emulator', 'qemu-system-aarch64'), ['-avd', avd], { stdio: 'ignore' }),
    shellCalls: () => readFileSync(join(sdk, 'adb.log'), 'utf8').split('\n').filter((line) => line.includes(' shell ') && !line.endsWith('sys.boot_completed')),
    stop: () => runningEmulators().filter((e) => e.avd === avd).forEach((e) => process.kill(e.pid, 'SIGKILL'))
  };
}

const KEEP_AWAKE = ['-s emulator-5554 shell svc power stayon true', '-s emulator-5554 shell input keyevent KEYCODE_WAKEUP', '-s emulator-5554 shell wm dismiss-keyguard'];

test('with-emulator keeps a headless emulator awake on boot and on every reuse', macOnly, () => {
  const sdk = fakeSdk(`ali_wake_${process.pid}`);
  try {
    const first = sdk.run();
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(sdk.shellCalls(), KEEP_AWAKE);
    const reused = sdk.run();
    assert.equal(reused.status, 0, reused.stderr);
    assert.doesNotMatch(reused.stderr, /booting/);
    assert.deepEqual(sdk.shellCalls(), [...KEEP_AWAKE, ...KEEP_AWAKE]);
  } finally {
    sdk.stop();
  }
});

test('with-emulator leaves the screen of a windowed emulator alone', macOnly, async () => {
  const sdk = fakeSdk(`ali_windowed_${process.pid}`);
  const windowed = sdk.startWindowed();
  try {
    await once(windowed, 'spawn');
    const r = sdk.run();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /booting/);
    assert.deepEqual(sdk.shellCalls(), []);
  } finally {
    windowed.kill('SIGKILL');
  }
});

test('off macOS the scripts refuse instead of running without a lock', { skip: platform() === 'darwin' && 'macOS runs them' }, () => {
  for (const args of [['with-emulator.mjs', 'test26', '--', 'true'], ['reap.mjs']]) {
    const r = spawnSync(process.execPath, [join(SCRIPTS, args[0]), ...args.slice(1)], {
      encoding: 'utf8',
      env: { ...process.env, ALI_EMULATOR_STATE: tmp() }
    });
    assert.equal(r.status, 2, `${args[0]}: ${r.stderr}`);
    assert.match(r.stderr, /macOS only/);
  }
});
