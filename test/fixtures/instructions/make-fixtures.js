#!/usr/bin/env node
// Builds the test scenarios for the instructions-global / instructions-project
// skills into a target directory: fake HOMEs and git repositories. Used by
// test/instructions-skills.test.js and by hand for skill runs:
//
//   node test/fixtures/instructions/make-fixtures.js <target-dir> [scenario ...]
//   HOME=<target-dir>/home-bloated node skills/instructions-global/scripts/inventory.js
//
// Non-English lines are written from escapes: the repository itself must stay
// free of Cyrillic (test/language.test.js), the fixture files may not.

import { mkdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const RU_ANSWER_BRIEFLY = '\u041e\u0442\u0432\u0435\u0447\u0430\u0439 \u043a\u0440\u0430\u0442\u043a\u043e.'; // "Answer briefly." in Russian

function write(path, content) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

const KARPATHY_FRAGMENT = `## 2. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.`;

/** A home with every problem the rubric knows, for the global skill. */
export function homeBloated(root, { withSymlink = false, karpathy = 'absent' } = {}) {
  const home = join(root, 'home-bloated');
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(join(home, '.copilot', 'instructions'), { recursive: true });
  const claude = [
    '# Global Claude Code Instructions',
    '',
    '## Branching',
    'Never commit or push to `main` directly. Always create a working branch, push it, and open a pull request.',
    'Never push to main.',
    'Do not push to main.',
    '',
    '## Style',
    'Write clean, maintainable code.',
    'Use meaningful variable names.',
    'Be careful.',
    "Don't add features beyond what was asked.",
    "Don't add features beyond what was asked; in particular never add npm dependencies without asking.",
    'For the foo-service repo, run `make dev` before tests.',
    'Build with `scripts/old-build.sh`.',
    'OpenAI key: sk-abcdefghijklmnopqrstuvwxyz123456',
    'Prefer pnpm over npm.',
    'Always run `npm test` after modifying JavaScript files.',
    '',
    '## Communication',
    'Talk to me in Russian.',
    RU_ANSWER_BRIEFLY,
    ''
  ].join('\n');
  write(join(home, '.claude', 'CLAUDE.md'), claude);
  write(join(home, '.codex', 'AGENTS.md'), ['Never push to main without asking.', 'Prefer pnpm over npm.', 'User prefers short answers without preamble.', ''].join('\n'));
  write(join(home, '.copilot', 'copilot-instructions.md'), 'Prefer pnpm over npm.\nWrite tests for new code.\n');
  if (karpathy === 'partial') write(join(home, '.copilot', 'instructions', 'karpathy.instructions.md'), `---\napplyTo: "**"\n---\n${KARPATHY_FRAGMENT}\n`);
  // memory: one cross-project preference, one project fact, one machine-specific fact
  const slug = '-Users-me-Workspace-foo-service';
  const mem = join(home, '.claude', 'projects', slug, 'memory');
  write(join(mem, 'MEMORY.md'), ['- [Short answers](short-answers.md) — user prefers short answers', '- [Tests](tests.md) — how to run tests', '- [Python](python.md) — local python path', ''].join('\n'));
  write(join(mem, 'short-answers.md'), '---\nname: short-answers\ndescription: communication preference\n---\n\nUser prefers short answers without preamble.\n');
  write(join(mem, 'tests.md'), '---\nname: tests\ndescription: test commands\n---\n\nTests: `pytest -q`; DB tests need `docker compose up db`.\n');
  write(join(mem, 'python.md'), '---\nname: python\ndescription: local interpreter\n---\n\nUse /opt/homebrew/bin/python3.11 for scripts.\n');
  mkdirSync(join(home, 'Workspace', 'foo-service'), { recursive: true });
  // VS Code: stable with useClaudeMdFile absent, Insiders with it true
  const vs = join(home, 'Library', 'Application Support');
  write(join(vs, 'Code', 'User', 'settings.json'), '{\n  // editor\n  "editor.fontSize": 14,\n  "chat.instructionsFilesLocations": { ".github/instructions": true },\n}\n');
  write(join(vs, 'Code - Insiders', 'User', 'settings.json'), '{\n  "chat.useClaudeMdFile": true,\n  "chat.agentHost.enabled": true\n}\n');
  write(join(vs, 'Code', 'User', 'prompts', 'legacy.instructions.md'), '---\napplyTo: "**"\n---\nPrefer pnpm over npm.\n');
  write(join(home, '.config', 'Code', 'User', 'settings.json'), '{\n  "editor.fontSize": 14\n}\n');
  if (withSymlink) {
    write(join(home, 'elsewhere', 'AGENTS.md'), 'linked\n');
    symlinkSync(join(home, 'elsewhere', 'AGENTS.md'), join(home, '.codex', 'AGENTS.override.md'));
  }
  return home;
}

/** A home where the global skill already ran once (master + rendered targets), for drift tests. */
export function homeMinimal(root) {
  const home = join(root, 'home-minimal');
  mkdirSync(join(home, '.claude'), { recursive: true });
  write(join(home, '.claude', 'CLAUDE.md'), '- Answer briefly.\n');
  return home;
}

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z' } });
}

function initRepo(dir, { email = 'me@example.com', name = 'Me' } = {}) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', email]);
  git(dir, ['config', 'user.name', name]);
  git(dir, ['config', 'commit.gpgsign', 'false']);
}

/** Solo repo with a root CLAUDE.md only. */
export function repoSolo(root) {
  const dir = join(root, 'repo-solo');
  initRepo(dir);
  write(join(dir, 'CLAUDE.md'), ['# Project', '', 'Always run `npm test` after modifying JavaScript files.', 'This repo uses npm; do not use pnpm.', 'Write clean, maintainable code.', 'Use the Claude `/review` command before opening a PR.', ''].join('\n'));
  write(join(dir, 'package.json'), '{ "name": "solo" }\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

/** Solo repo with AGENTS.md and CLAUDE.md that disagree, plus a copilot file and nested files. */
export function repoMixed(root) {
  const dir = join(root, 'repo-mixed');
  initRepo(dir);
  write(join(dir, 'AGENTS.md'), ['# mixed', '', '## Commands', '- Tests: `npm test`', '', '## Conventions', '- Use npm, never pnpm.', ''].join('\n'));
  write(join(dir, 'CLAUDE.md'), ['Run `npm run lint` before committing.', 'Use pnpm for everything.', ''].join('\n'));
  write(join(dir, '.github', 'copilot-instructions.md'), 'Tests: `npm test`\nNever commit secrets.\n');
  write(join(dir, 'packages', 'api', 'AGENTS.md'), '# api\n- Run `npm run api:test`.\n');
  write(join(dir, '.claude', 'rules', 'ts.md'), '---\npaths: ["**/*.ts"]\n---\nPrefer `unknown` over `any`.\n');
  write(join(dir, '.github', 'instructions', 'docs.instructions.md'), '---\napplyTo: "docs/**"\n---\nUse sentence case in headings.\n');
  write(join(dir, 'AGENTS.override.md'), '# override\n- Only for Codex experiments.\n');
  write(join(dir, '.vscode', 'settings.json'), '{\n  "chat.useClaudeMdFile": true\n}\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  return dir;
}

/** Team repo: two authors, CODEOWNERS. */
export function repoTeam(root) {
  const dir = join(root, 'repo-team');
  initRepo(dir);
  write(join(dir, 'AGENTS.md'), '# team\n- Tests: `make test`\n');
  write(join(dir, '.github', 'CODEOWNERS'), '* @someone-else\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'init']);
  git(dir, ['commit', '-q', '--allow-empty', '-m', 'by other'], { GIT_AUTHOR_EMAIL: 'other@example.com', GIT_AUTHOR_NAME: 'Other', GIT_COMMITTER_EMAIL: 'other@example.com', GIT_COMMITTER_NAME: 'Other' });
  return dir;
}

/** Plain directory, no git. */
export function dirNoGit(root) {
  const dir = join(root, 'dir-nogit');
  write(join(dir, 'CLAUDE.md'), 'Not a repo.\n');
  return dir;
}

export const SCENARIOS = { 'home-bloated': homeBloated, 'home-minimal': homeMinimal, 'repo-solo': repoSolo, 'repo-mixed': repoMixed, 'repo-team': repoTeam, 'dir-nogit': dirNoGit };

export function buildAll(root, names = Object.keys(SCENARIOS)) {
  const out = {};
  for (const name of names) {
    if (!SCENARIOS[name]) throw new Error(`unknown scenario ${name}`);
    out[name] = SCENARIOS[name](root);
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  const [target, ...names] = process.argv.slice(2);
  if (!target) {
    console.error('usage: make-fixtures.js <target-dir> [scenario ...]\nscenarios: ' + Object.keys(SCENARIOS).join(', '));
    process.exit(1);
  }
  if (existsSync(target) && !names.length) console.error(`note: ${target} exists; scenarios are written into it`);
  const built = buildAll(target, names.length ? names : undefined);
  for (const [name, path] of Object.entries(built)) console.log(`${name}: ${path}`);
}
