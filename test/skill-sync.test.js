import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { skillsSourceDir } from '../src/config.js';

// Some blocks are deliberately duplicated across skills: the skills install into
// several agents with no shared file to point at, so each copy must be complete.
// These tests are what keeps the copies from drifting — an edit to one side
// fails the build until the other side matches.

// Normalized to LF so the paragraph-boundary search below works on a CRLF
// checkout too — the repo has no .gitattributes and supports CRLF sources.
const read = (name) =>
  readFileSync(join(skillsSourceDir, name, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');

/**
 * Slice from `startMarker` through the paragraph containing `endMarker`
 * (up to the next blank line). Anchored on wording, not line numbers, so the
 * files can move freely around the shared block.
 */
function block(name, startMarker, endMarker = startMarker) {
  const text = read(name);
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `${name}: start marker not found: "${startMarker}"`);
  const end = text.indexOf(endMarker, start);
  assert.notEqual(end, -1, `${name}: end marker not found: "${endMarker}"`);
  const stop = text.indexOf('\n\n', end);
  return text.slice(start, stop === -1 ? text.length : stop);
}

// "The bar a finding has to clear" — review-pr judges a PR, review-branch the
// working tree. Same bar, different channel: each entry is the one wording pair
// allowed to differ, [review-pr, review-branch]. Everything else must match.
const CHANNEL_VARIANTS = [
  ['nothing else gets published.', 'nothing else is raised.'],
  ["nothing in the PR's purpose asks for", "nothing in the work's purpose asks for"],
  ['logic the diff already has elsewhere', 'logic the branch already has elsewhere'],
  ['A suggestion never holds up a merge', 'A suggestion never holds the work back'],
  [
    'has no evidence and is not published — say it in the chat if it matters.',
    'has no evidence and is not raised as a finding — mention it in one line if it matters at all.'
  ],
  ['leaves a PR longer and more brittle', 'leaves the work longer and more brittle']
];

function withoutChannelWording(text, column, name) {
  let out = text;
  CHANNEL_VARIANTS.forEach((pair, i) => {
    const variant = pair[column];
    const occurrences = out.split(variant).length - 1;
    assert.equal(
      occurrences,
      1,
      `${name}: expected exactly one occurrence of "${variant}" in the bar section — ` +
        'if the wording changed on purpose, update CHANNEL_VARIANTS in this test'
    );
    out = out.replace(variant, `<channel ${i}>`);
  });
  return out;
}

test('review-pr and review-branch state the same bar for a finding', () => {
  const barOf = (name) =>
    block(name, 'A review is worth running only if', 'Not looked for at all:');

  assert.equal(
    withoutChannelWording(barOf('review-pr'), 0, 'review-pr'),
    withoutChannelWording(barOf('review-branch'), 1, 'review-branch'),
    'The bar section differs beyond the allowed channel wording. It is duplicated on ' +
      'purpose — apply the same edit to both skills/review-pr/SKILL.md and ' +
      'skills/review-branch/SKILL.md, or extend CHANNEL_VARIANTS for an intentional difference.'
  );
});

test('review-pr and process-pr-comments give the same literal-path rule', () => {
  const marker = '**Name the file by the literal absolute path';

  assert.equal(
    block('review-pr', marker),
    block('process-pr-comments', marker),
    'The literal-absolute-path paragraph is duplicated on purpose and must stay ' +
      'byte-identical — apply the same edit to both skills/review-pr/SKILL.md and ' +
      'skills/process-pr-comments/SKILL.md.'
  );
});
