// Shared by with-emulator.mjs and reap.mjs. State lives per AVD under
// STATE_ROOT/<avd>/: leases/<pid> (one per wrapper using the emulator),
// last-used and first-seen (epoch ms), lock/ (mkdir lock, macOS has no flock).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

// shortcut: fixed timings, make them options when a second value is needed.
export const IDLE_MS = 20 * 60_000;
export const REAP_INTERVAL_S = 300;
export const BOOT_TIMEOUT_MS = 5 * 60_000;

export const STATE_ROOT = process.env.ALI_EMULATOR_STATE ?? join(homedir(), '.ali-android-emulator');
export const AVD_NAME = /^[A-Za-z0-9._-]+$/;

export const sdkRoot = () =>
  process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'Library', 'Android', 'sdk');

const sdkTool = (dir, name) => {
  const path = join(sdkRoot(), dir, name);
  return existsSync(path) ? path : name;
};
export const adbPath = () => sdkTool('platform-tools', 'adb');
export const emulatorPath = () => sdkTool('emulator', 'emulator');

export const avdDir = (avd) => join(STATE_ROOT, avd);

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * What the reaper does with one AVD. `emulator` is its running process or null,
 * `state` what readAvdState found or null.
 * @returns {{dead: number[], verdict: 'keep' | 'kill' | 'mark-seen' | 'forget'}}
 */
export function decide({ emulator, state, isAlive, now, idleMs }) {
  const leases = state?.leases ?? [];
  const dead = leases.filter((pid) => !isAlive(pid));
  const held = dead.length < leases.length;

  if (!emulator) return { dead, verdict: held ? 'keep' : 'forget' };
  // A windowed emulator is a person's.
  if (!emulator.headless || held) return { dead, verdict: 'keep' };

  const since = Math.max(state?.lastUsed ?? -Infinity, state?.firstSeen ?? -Infinity);
  if (since === -Infinity) return { dead, verdict: 'mark-seen' };
  return { dead, verdict: now - since >= idleMs ? 'kill' : 'keep' };
}

/** Emulator processes in `ps -axo pid=,command=` output. */
export function parseProcesses(text) {
  const found = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(.*?qemu-system-\S+)(.*)$/);
    const avd = match?.[3].match(/(?:^|\s)-avd\s+(\S+)/)?.[1];
    if (avd) found.push({ pid: Number(match[1]), avd, headless: basename(match[2]).endsWith('-headless') });
  }
  return found;
}

export const runningEmulators = () =>
  parseProcesses(execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }));

const readStamp = (path) => {
  try {
    return Number(readFileSync(path, 'utf8').trim()) || null;
  } catch {
    return null;
  }
};

export function readAvdState(dir) {
  if (!existsSync(dir)) return null;
  const leasesDir = join(dir, 'leases');
  const leases = existsSync(leasesDir) ? readdirSync(leasesDir).map(Number).filter(Number.isInteger).sort((a, b) => a - b) : [];
  return { leases, lastUsed: readStamp(join(dir, 'last-used')), firstSeen: readStamp(join(dir, 'first-seen')) };
}

export const stamp = (dir, name, now = Date.now()) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${now}\n`);
};

/** Take the AVD's lock without waiting; a lock whose holder died is taken over. */
export function tryLock(dir) {
  const lock = join(dir, 'lock');
  mkdirSync(dir, { recursive: true });
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // No pid yet means the holder is between mkdir and write: still held.
    const owner = readStamp(join(lock, 'pid'));
    if (!owner || isAlive(owner)) return false;
    rmSync(lock, { recursive: true, force: true });
    return tryLock(dir);
  }
  writeFileSync(join(lock, 'pid'), String(process.pid));
  return true;
}

export const unlock = (dir) => rmSync(join(dir, 'lock'), { recursive: true, force: true });

/** The adb serial of the running emulator with this AVD, or null. */
export function serialOf(avd) {
  const adb = adbPath();
  let devices;
  try {
    devices = execFileSync(adb, ['devices'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
  for (const serial of devices.match(/^emulator-\d+(?=\s)/gm) ?? []) {
    try {
      const name = execFileSync(adb, ['-s', serial, 'emu', 'avd', 'name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (name.split(/\r?\n/)[0].trim() === avd) return serial;
    } catch {
      // An emulator still coming up does not answer its console yet.
    }
  }
  return null;
}
