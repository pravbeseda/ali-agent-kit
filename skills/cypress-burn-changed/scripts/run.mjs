#!/usr/bin/env node
// Puts burn-changed-tests.mjs into the project's testing/Cypress/scripts/ for
// the length of one run and takes it out again on every way out: success, a
// failed burn, a crash, Ctrl-C, SIGTERM. The script has to sit there because it
// imports its project siblings and derives the cypress dir from its own path.
// Every argument is passed through to it unchanged.
//
// Exit code: the script's own (1 = some burn failed), 128 + n when stopped by
// signal n, 2 when it refused to start and nothing was copied.

import { execFileSync, spawn } from 'node:child_process';
import { constants, copyFileSync, existsSync, rmSync } from 'node:fs';
import { constants as os } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = 'burn-changed-tests.mjs';
const source = join(dirname(fileURLToPath(import.meta.url)), SCRIPT);

function refuse(message) {
  console.error(`ali-cypress-burn-changed: ${message}`);
  process.exit(2);
}

let root;
try {
  root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {
  refuse(`${process.cwd()} is not inside a git repository — run from the project whose cypress tests to burn.`);
}

const cypressDir = join(root, 'testing', 'Cypress');
const target = join(cypressDir, 'scripts', SCRIPT);

if (!existsSync(join(cypressDir, 'scripts'))) {
  refuse(`${root} has no testing/Cypress/scripts/ — this is not a project the burn script can run in.`);
}

try {
  // COPYFILE_EXCL: a file the project already has is never overwritten, and so never deleted.
  copyFileSync(source, target, constants.COPYFILE_EXCL);
} catch (error) {
  if (error.code === 'EEXIST') {
    refuse(`${target} already exists and is not ours — run it directly: cd testing/Cypress && node ./scripts/${SCRIPT}`);
  }
  throw error;
}

// From here on the copy is ours. It is removed synchronously, so neither a
// signal nor a crash can leave it behind; removing it twice is harmless.
const removeCopy = () => rmSync(target, { force: true });
process.on('exit', removeCopy);

const child = spawn(process.execPath, [target, ...process.argv.slice(2)], { cwd: cypressDir, stdio: 'inherit' });

let stoppedBy = null;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    // The script imports everything statically, so once it runs the copy can go
    // before its own cleanup ends; one stopped before that has nothing to lose.
    // The wrapper still waits for it to exit.
    removeCopy();
    stoppedBy ??= signal;
    child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error(`ali-cypress-burn-changed: could not start ${target}: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  const by = stoppedBy ?? signal;
  process.exit(by ? 128 + os.signals[by] : code);
});
