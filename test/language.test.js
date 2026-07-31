import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from '../src/config.js';

// Built from escapes on purpose: a literal character class would make this file
// the first offender it finds.
const CYRILLIC = new RegExp('[\\u0400-\\u04FF\\u0500-\\u052F]');
const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|pdf|zip|gz|woff2?)$/i;

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: packageRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  } catch {
    return [];
  }
}

test('every source, doc and skill is written in English', () => {
  const files = trackedFiles();
  assert.ok(files.length, 'expected a git checkout to scan');

  const offenders = [];
  for (const file of files) {
    if (BINARY.test(file)) continue;
    const content = readFileSync(join(packageRoot, file), 'utf8');
    content.split(/\r?\n/).forEach((line, index) => {
      if (CYRILLIC.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }

  assert.deepEqual(offenders, [], `Cyrillic is not allowed in this project:\n${offenders.join('\n')}`);
});
