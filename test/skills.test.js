import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSkills, prefixed, parseFrontmatter, rewriteFrontmatter } from '../src/skills.js';
import { skillsSourceDir } from '../src/config.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ali-kit-'));

test('prefixed adds ali- once', () => {
  assert.equal(prefixed('review-branch'), 'ali-review-branch');
  assert.equal(prefixed('ali-review-branch'), 'ali-review-branch');
});

test('loads a single-file skill and prefixes its frontmatter name', () => {
  const dir = tmp();
  writeFileSync(
    join(dir, 'review-branch.md'),
    '---\nname: review-branch\ndescription: Review the branch\n---\n\n# Body\n'
  );

  const [skill] = loadSkills(dir);
  assert.equal(skill.sourceName, 'review-branch');
  assert.equal(skill.name, 'ali-review-branch');
  assert.equal(skill.description, 'Review the branch');
  assert.equal(skill.files.length, 1);
  assert.equal(skill.files[0].path, 'SKILL.md');
  assert.match(skill.files[0].content, /^---\nname: ali-review-branch\ndescription: Review the branch\n---/);
  assert.match(skill.files[0].content, /# Body/);
});

test('loads a directory skill with extra assets', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'deep/refs'), { recursive: true });
  writeFileSync(join(dir, 'deep/SKILL.md'), '---\nname: deep\n---\nbody\n');
  writeFileSync(join(dir, 'deep/refs/notes.md'), 'notes');

  const [skill] = loadSkills(dir);
  assert.equal(skill.name, 'ali-deep');
  assert.deepEqual(
    skill.files.map((f) => f.path).sort(),
    ['SKILL.md', 'refs/notes.md']
  );
});

test('adds frontmatter when the source has none', () => {
  const out = rewriteFrontmatter('# Just a body\n', { name: 'ali-x', description: 'd' });
  assert.equal(out, '---\nname: ali-x\ndescription: d\n---\n\n# Just a body\n');
});

test('keeps unrelated frontmatter fields untouched', () => {
  const out = rewriteFrontmatter('---\nname: x\nallowed-tools: Bash\n---\nb\n', { name: 'ali-x' });
  assert.match(out, /allowed-tools: Bash/);
  assert.match(out, /name: ali-x/);
});

test('parses folded multi-line descriptions', () => {
  const { description } = parseFrontmatter('---\nname: x\ndescription: one\n  two\n---\nb');
  assert.equal(description, 'one two');
});

test('the shipped skills all parse and are prefixed', () => {
  assert.ok(existsSync(skillsSourceDir));
  const skills = loadSkills();
  assert.ok(skills.length > 0);
  for (const skill of skills) {
    assert.ok(skill.name.startsWith('ali-'), `${skill.name} lacks prefix`);
    assert.ok(skill.description, `${skill.name} has no description`);
    const head = skill.files.find((f) => f.path === 'SKILL.md').content.toString();
    assert.match(head, new RegExp(`^---\\nname: ${skill.name}\\n`));
  }
});

test('ignores dotfiles and dirs without SKILL.md', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'not-a-skill'));
  writeFileSync(join(dir, 'not-a-skill/readme.md'), 'x');
  writeFileSync(join(dir, '.hidden.md'), 'x');
  assert.deepEqual(loadSkills(dir), []);
});

test('source files are read verbatim except for the name line', () => {
  const dir = tmp();
  const body = '---\nname: keep\ndescription: d\n---\n\nline1\n\n```sh\necho hi\n```\n';
  writeFileSync(join(dir, 'keep.md'), body);
  const [skill] = loadSkills(dir);
  assert.equal(skill.files[0].content, body.replace('name: keep', 'name: ali-keep'));
  assert.equal(readFileSync(join(dir, 'keep.md'), 'utf8'), body);
});
