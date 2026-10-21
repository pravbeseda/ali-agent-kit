import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { skillsSourceDir } from '../src/config.js';

// A skill's Markdown points at its own bundled files by `references/…` and
// `scripts/…` paths. Shared files are copied between skills, so a path that
// resolves in one copy can dangle in the other — these tests catch that.

const skillDirs = readdirSync(skillsSourceDir).filter((name) =>
  existsSync(join(skillsSourceDir, name, 'SKILL.md'))
);

function markdownFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return entry.endsWith('.md') ? [full] : [];
  });
}

// Not preceded by a path character, so `testing/Cypress/scripts/x.mjs` or
// `<skill>/scripts/run.mjs` (a target project's path, or one already anchored)
// is not read as a path inside the skill.
const BUNDLED_PATH = /(?<![\w./<>-])(?:references|scripts)\/[\w./-]+\.(?:md|js|mjs)/g;

test('every bundled file a skill names exists in that skill', () => {
  const missing = [];
  for (const name of skillDirs) {
    const root = join(skillsSourceDir, name);
    for (const file of markdownFiles(root)) {
      for (const [path] of readFileSync(file, 'utf8').matchAll(BUNDLED_PATH)) {
        if (!existsSync(join(root, path))) {
          missing.push(`${relative(skillsSourceDir, file).split(sep).join('/')}: ${path}`);
        }
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('skills run bundled scripts through the skill directory, not the working directory', () => {
  const found = [];
  for (const name of skillDirs) {
    for (const file of markdownFiles(join(skillsSourceDir, name))) {
      for (const [command] of readFileSync(file, 'utf8').matchAll(/node scripts\/\S+/g)) {
        found.push(`${relative(skillsSourceDir, file).split(sep).join('/')}: ${command}`);
      }
    }
  }
  assert.deepEqual(found, [], 'write `node <skill>/scripts/…` — the scripts run from the user\'s directory');
});
