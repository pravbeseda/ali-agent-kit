#!/usr/bin/env node
// Run by launchd every few minutes (install-reaper.mjs). Shuts down every
// headless emulator nobody holds a lease on and nobody has used for IDLE_MS;
// one booted around with-emulator is timed from the first time it is seen.
// Windowed emulators are never touched. An AVD whose lock is held is skipped
// until the next run.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AVD_NAME, IDLE_MS, STATE_ROOT, adbPath, avdDir, decide, isAlive, readAvdState, runningEmulators, serialOf, stamp, tryLock, unlock } from './lib.mjs';

const log = (avd, message) => console.log(`${new Date().toISOString()} ${avd}: ${message}`);

const emulators = runningEmulators();
const known = existsSync(STATE_ROOT)
  ? readdirSync(STATE_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && AVD_NAME.test(entry.name))
      .map((entry) => entry.name)
  : [];
const now = Date.now();

for (const avd of [...new Set([...emulators.map((e) => e.avd), ...known])].sort()) {
  const emulator = emulators.find((e) => e.avd === avd) ?? null;
  const dir = avdDir(avd);
  if (emulator && !emulator.headless && !existsSync(dir)) continue;
  if (!tryLock(dir)) continue;

  try {
    const { dead, verdict } = decide({ emulator, state: readAvdState(dir), isAlive, now, idleMs: IDLE_MS });
    for (const pid of dead) rmSync(join(dir, 'leases', String(pid)), { force: true });

    if (verdict === 'mark-seen') {
      stamp(dir, 'first-seen', now);
      log(avd, 'first seen without a lease, idle clock started');
    } else if (verdict === 'forget') {
      rmSync(dir, { recursive: true, force: true });
    } else if (verdict === 'kill') {
      const serial = serialOf(avd);
      if (!serial) {
        log(avd, 'idle, but adb does not see it; left running');
        continue;
      }
      execFileSync(adbPath(), ['-s', serial, 'emu', 'kill'], { stdio: 'ignore' });
      // A later boot must start a fresh clock, not inherit this one.
      rmSync(dir, { recursive: true, force: true });
      log(avd, `idle for ${IDLE_MS / 60_000} minutes, killed ${serial}`);
    }
  } finally {
    unlock(dir);
  }
}
