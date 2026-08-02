import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadSkills,
  prefixed,
  parseFrontmatter,
  rewriteFrontmatter,
  SkillError
} from '../src/skills.js';
import { skillsSourceDir, MARKER, INSTALL_NOTICE, NOTICE_SENTINEL } from '../src/config.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ali-kit-'));
const skillFile = (name, extra = '') =>
  `---\nname: ${name}\ndescription: Test skill for ${name}.${extra}\n---\n\nbody\n`;

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
  writeFileSync(join(dir, 'deep/SKILL.md'), skillFile('deep'));
  writeFileSync(join(dir, 'deep/refs/notes.md'), 'notes');

  const [skill] = loadSkills(dir);
  assert.equal(skill.name, 'ali-deep');
  assert.deepEqual(skill.files.map((f) => f.path).sort(), ['SKILL.md', 'refs/notes.md']);
});

test('rejects a missing description', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'bad.md'), '---\nname: bad\n---\nbody\n');
  assert.throws(() => loadSkills(dir), SkillError, /description/);
});

test('rejects frontmatter name that does not match the file name', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'one.md'), skillFile('two'));
  assert.throws(() => loadSkills(dir), /must match the source name/);
});

test('rejects missing frontmatter', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'bare.md'), '# no frontmatter\n');
  assert.throws(() => loadSkills(dir), /frontmatter/);
});

test('rejects the reserved prefix in a source name', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'ali-thing.md'), skillFile('ali-thing'));
  assert.throws(() => loadSkills(dir), /reserved "ali-" prefix/);
});

test('rejects a non-kebab-case source name', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'Bad_Name.md'), skillFile('Bad_Name'));
  assert.throws(() => loadSkills(dir), /lowercase letters/);
});

test('rejects the same skill defined twice', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'twice.md'), skillFile('twice'));
  mkdirSync(join(dir, 'twice'));
  writeFileSync(join(dir, 'twice/SKILL.md'), skillFile('twice'));
  assert.throws(() => loadSkills(dir), /duplicate skill/);
});

test('rejects symlinks and the reserved marker file inside a skill', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'linky'));
  writeFileSync(join(dir, 'linky/SKILL.md'), skillFile('linky'));
  symlinkSync('/etc/hosts', join(dir, 'linky/hosts'));
  assert.throws(() => loadSkills(dir), /symbolic links/);

  const other = tmp();
  mkdirSync(join(other, 'marked'));
  writeFileSync(join(other, 'marked/SKILL.md'), skillFile('marked'));
  writeFileSync(join(other, 'marked', MARKER), '{}');
  assert.throws(() => loadSkills(other), /reserved for installed-skill ownership/);
});

test('a UTF-8 BOM does not hide the frontmatter', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'bommed.md'), `\uFEFF${skillFile('bommed')}`);

  const [skill] = loadSkills(dir);
  assert.equal(skill.name, 'ali-bommed');
  assert.ok(!skill.files[0].content.startsWith('\uFEFF'), 'the BOM must be stripped on the way out');
});

test('adds frontmatter when the source has none', () => {
  const out = rewriteFrontmatter('# Just a body\n', { name: 'ali-x', description: 'd' });
  assert.equal(out, '---\nname: ali-x\ndescription: d\n---\n\n# Just a body\n');
});

test('keeps unrelated frontmatter fields untouched', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'tooled.md'), '---\nname: tooled\ndescription: d\nallowed-tools: Bash\n---\nb\n');
  const [skill] = loadSkills(dir);
  assert.match(skill.files[0].content, /allowed-tools: Bash/);
  assert.match(skill.files[0].content, /name: ali-tooled/);
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

test('source files are read verbatim except for the name line and the notice', () => {
  const dir = tmp();
  const body = '---\nname: keep\ndescription: d\n---\n\nline1\n\n```sh\necho hi\n```\n';
  writeFileSync(join(dir, 'keep.md'), body);
  const [skill] = loadSkills(dir);
  const installed = skill.files[0].content;
  assert.equal(
    installed.replace(`\n${INSTALL_NOTICE}\n`, '\n'),
    body.replace('name: keep', 'name: ali-keep')
  );
  assert.equal(readFileSync(join(dir, 'keep.md'), 'utf8'), body);
});

test('the managed-file notice lands under the frontmatter, exactly once', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'noted.md'), skillFile('noted'));
  const [skill] = loadSkills(dir);
  const lines = skill.files[0].content.split('\n');

  assert.equal(lines.indexOf('---'), 0);
  assert.equal(lines[lines.indexOf('---', 1) + 2], NOTICE_SENTINEL);
  assert.equal(skill.files[0].content.split(NOTICE_SENTINEL).length - 1, 1);
  assert.match(skill.files[0].content, /ali-agent-kit install` replaces it/);
});

test('a CRLF source comes out entirely CRLF, notice included', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'crlf.md'), '---\r\nname: crlf\r\ndescription: d\r\n---\r\n\r\n# Body\r\n');
  const [skill] = loadSkills(dir);
  const installed = skill.files[0].content;

  assert.ok(!/(?<!\r)\n/.test(installed), 'no lone LF may survive in a CRLF skill');
  assert.ok(
    installed.endsWith(`${INSTALL_NOTICE.replace(/\n/g, '\r\n')}\r\n# Body\r\n`),
    'the notice follows the frontmatter directly, with the source line ending'
  );
});

test('a source skill carrying the notice itself is rejected', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'preloaded.md'), `${skillFile('preloaded')}\n${NOTICE_SENTINEL}\n`);
  assert.throws(() => loadSkills(dir), (error) => {
    assert.ok(error instanceof SkillError);
    assert.match(error.message, /managed-file notice/);
    return true;
  });
});
