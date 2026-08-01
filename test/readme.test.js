import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot } from '../src/config.js';
import { loadSkills } from '../src/skills.js';

// The "Skills" table in the README is written by hand; only its descriptions
// are editorial. The set of rows is not — this test is what fails when a skill
// is added, renamed or deleted and the table is forgotten.
function documentedSkills() {
  const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8');
  const section = readme.match(/^## Skills\r?\n([\s\S]*?)(?=^## )/m);
  assert.ok(section, 'README has no "## Skills" section');

  return section[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|/))
    .filter(Boolean)
    .map((match) => match[1]);
}

test('the README skills table lists exactly the shipped skills', () => {
  const documented = documentedSkills();
  const shipped = loadSkills().map((skill) => skill.name);

  assert.deepEqual(
    [...documented].sort(),
    [...shipped].sort(),
    'update the "## Skills" table in README.md to match skills/'
  );
});

test('the README skills table describes every skill', () => {
  const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8');
  const section = readme.match(/^## Skills\r?\n([\s\S]*?)(?=^## )/m)[1];

  const undescribed = section
    .split(/\r?\n/)
    .map((line) => line.match(/^\|\s*`([^`]+)`\s*\|(.*)\|/))
    .filter(Boolean)
    .filter(([, , description]) => description.trim().length < 20)
    .map(([, name]) => name);

  assert.deepEqual(undescribed, [], 'every row needs a description of its own');
});
