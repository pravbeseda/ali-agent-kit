#!/usr/bin/env node
// with-emulator <avd> -- <command...>
// Boots the AVD headless unless it is running, holds a lease on it while the
// command runs with ANDROID_SERIAL set, then stamps last-used and lets go. It
// never kills the emulator: reap.mjs does that once nobody has used it for a
// while, so back-to-back runs do not reboot it.
//
// Exit code: the command's own, 128 + n when stopped by signal n, 2 when the
// arguments are wrong or this is not macOS, 1 when the emulator could not be
// booted.

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { constants as os } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  AVD_NAME,
  BOOT_TIMEOUT_MS,
  REAPER_RAN,
  STATE_ROOT,
  adbPath,
  avdDir,
  emulatorPath,
  lockPath,
  logPath,
  readStamp,
  reaperSilent,
  refuseUnlessMacOS,
  runningEmulators,
  serialOf,
  stamp,
  tryLock,
  unlock
} from './lib.mjs';

const USAGE = 'usage: with-emulator.mjs <avd> -- <command...>';

function refuse(message) {
  console.error(`ali-android-emulator: ${message}\n${USAGE}`);
  process.exit(2);
}

const [avd, separator, ...command] = process.argv.slice(2);
if (!avd || separator !== '--' || !command.length) refuse('expected an AVD name, then --, then the command');
if (!AVD_NAME.test(avd)) refuse(`"${avd}" is not an AVD name`);
refuseUnlessMacOS();

const dir = avdDir(avd);
const lease = join(dir, 'leases', String(process.pid));

// Last-used goes first, so the reaper never sees the lease gone and an old clock.
process.on('exit', () => {
  stamp(dir, 'last-used');
  rmSync(lease, { force: true });
});

function fail(message) {
  console.error(`ali-android-emulator: ${message}`);
  process.exit(1);
}

async function waitFor(what, check, deadline) {
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await sleep(2_000);
  }
  fail(`timed out waiting for ${what} of ${avd}`);
}

function booted(serial) {
  try {
    const out = execFileSync(adbPath(), ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() === '1';
  } catch {
    return false;
  }
}

/** Under the AVD's lock: the reaper cannot kill it between the lease and the check, nor two wrappers boot it twice. */
async function acquire() {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  const lock = await waitFor('the lock', () => tryLock(lockPath(avd)), deadline);
  try {
    mkdirSync(join(dir, 'leases'), { recursive: true });
    writeFileSync(lease, '');

    let emulator = null;
    if (!runningEmulators().some((e) => e.avd === avd)) {
      const log = logPath(avd);
      const out = openSync(log, 'w');
      emulator = spawn(emulatorPath(), ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot-save'], {
        detached: true,
        stdio: ['ignore', out, out]
      });
      emulator.on('error', (error) => fail(`could not start the emulator: ${error.message}`));
      emulator.on('exit', (code) => fail(`the emulator exited with code ${code} while booting, see ${log}`));
      emulator.unref();
      console.error(`ali-android-emulator: booting ${avd} headless (log: ${log})`);
    }

    const serial = await waitFor('the adb serial', () => serialOf(avd), deadline);
    await waitFor('boot to complete', () => booted(serial), deadline);
    emulator?.removeAllListeners('exit');
    return serial;
  } finally {
    unlock(lock);
  }
}

let child = null;
let stoppedBy = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stoppedBy ??= signal;
    if (child) child.kill(signal);
    else process.exit(128 + os.signals[signal]);
  });
}

const serial = await acquire();
const lastRan = readStamp(join(STATE_ROOT, REAPER_RAN));
if (reaperSilent(lastRan, Date.now())) {
  const since = lastRan === null ? 'has never run' : `has not run since ${new Date(lastRan).toISOString()}`;
  const installer = join(dirname(fileURLToPath(import.meta.url)), 'install-reaper.mjs');
  console.error(`ali-android-emulator: the reaper ${since}, so idle emulators stay up; register it with: node ${installer}`);
}
child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: { ...process.env, ANDROID_SERIAL: serial } });

child.on('error', (error) => fail(`could not start ${command[0]}: ${error.message}`));
child.on('exit', (code, signal) => {
  const by = stoppedBy ?? signal;
  process.exit(by ? 128 + os.signals[by] : code);
});
