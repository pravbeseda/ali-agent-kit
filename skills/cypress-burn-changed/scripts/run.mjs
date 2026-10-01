#!/usr/bin/env node
// Puts burn-changed-tests.mjs into the project's testing/Cypress/scripts/ for
// the length of one run and takes it out again on every way out: success, a
// failed burn, a crash, Ctrl-C, SIGTERM, a closed terminal. The script has to
// sit there because it imports its project siblings and derives the cypress dir
// from its own path.
// Every argument is passed through to it unchanged.
//
// Exit code: the script's own (1 = some burn failed), 128 + n when stopped by
// signal n, 2 when it refused to start and nothing was copied.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants as os } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = 'burn-changed-tests.mjs';
const source = join(dirname(fileURLToPath(import.meta.url)), SCRIPT);
// The first line of every copy, so a copy of ours that is still there — another
// run in this checkout, or one killed with no chance to clean up — is told apart
// from a script the project adopted.
const MARK = '// ali-cypress-burn-changed: temporary copy, removed when the run ends\n';

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
  // `wx`: a file already there is never overwritten, and so never deleted.
  writeFileSync(target, MARK + readFileSync(source, 'utf8'), { flag: 'wx' });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  if (readFileSync(target, 'utf8').startsWith(MARK)) {
    refuse(
      `${target} is a copy left there by this skill: either another burn is running in this checkout, ` +
        'or a run was killed before it could clean up. If no burn is running, delete it and run again.'
    );
  }
  refuse(`${target} already exists and is not ours — run it directly: cd testing/Cypress && node ./scripts/${SCRIPT}`);
}

// From here on the copy is ours. It is removed synchronously, so only a
// SIGKILL can leave it behind; removing it twice is harmless.
const removeCopy = () => rmSync(target, { force: true });
process.on('exit', removeCopy);

const child = spawn(process.execPath, [target, ...process.argv.slice(2)], { cwd: cypressDir, stdio: 'inherit' });

let stoppedBy = null;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
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
