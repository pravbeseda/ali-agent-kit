#!/usr/bin/env node
// Registers reap.mjs (the copy next to this file) as a launchd agent of the
// current user, or removes it with --uninstall. Run again after the skill moved.
// A plist of the same name that this script did not write is left alone.
//
// Exit code: 0 done, 2 refused (not macOS, unknown argument, foreign plist).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAP_INTERVAL_S, STATE_ROOT, sdkRoot } from './lib.mjs';

const LABEL = 'com.github.pravbeseda.ali-android-emulator.reaper';
const MARK = '<!-- ali-agent-kit: android-emulator reaper -->';
const plist = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const reaper = join(dirname(fileURLToPath(import.meta.url)), 'reap.mjs');
const domain = `gui/${process.getuid()}`;

function refuse(message) {
  console.error(`ali-android-emulator: ${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (platform() !== 'darwin') refuse('the reaper runs on launchd, which only macOS has');
if (args.length > 1 || (args.length && args[0] !== '--uninstall')) refuse('usage: install-reaper.mjs [--uninstall]');
if (existsSync(plist) && !readFileSync(plist, 'utf8').includes(MARK)) refuse(`${plist} exists and was not written by this skill`);

const unload = () => {
  try {
    execFileSync('launchctl', ['bootout', domain, plist], { stdio: 'ignore' });
  } catch {
    // Not loaded.
  }
};

if (args[0] === '--uninstall') {
  unload();
  rmSync(plist, { force: true });
  console.log(`Removed ${plist}`);
  process.exit(0);
}

const xml = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const string = (s) => `<string>${xml(s)}</string>`;
const logFile = join(STATE_ROOT, 'reaper.log');

mkdirSync(STATE_ROOT, { recursive: true });
mkdirSync(dirname(plist), { recursive: true });
writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
${MARK}
<plist version="1.0">
<dict>
  <key>Label</key>${string(LABEL)}
  <key>ProgramArguments</key>
  <array>${string(process.execPath)}${string(reaper)}</array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ANDROID_HOME</key>${string(sdkRoot())}
    <key>ALI_EMULATOR_STATE</key>${string(STATE_ROOT)}
  </dict>
  <key>StartInterval</key><integer>${REAP_INTERVAL_S}</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key>${string(logFile)}
  <key>StandardErrorPath</key>${string(logFile)}
</dict>
</plist>
`
);
unload();
execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'inherit' });
console.log(`Reaper loaded: ${reaper} every ${REAP_INTERVAL_S}s, log ${logFile}`);
