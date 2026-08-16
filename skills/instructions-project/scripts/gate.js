#!/usr/bin/env node
// instructions-project: the gate. Refuse outside a git repository; classify the
// repository as personal or shared from evidence; refuse a shared repository
// unless --shared-ok was given for this run. Prints the evidence either way.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { run, isMain, EXIT } from './lib/cli.js';
import { loadConfig } from './lib/config.js';

const HELP = `usage: node gate.js [--dir <path>] [--shared-ok] [--plain-dir] [--json]

Exit 0: proceed (personal repo, or shared with --shared-ok, or --plain-dir).
Exit 2: stop — not a git repository, or shared without --shared-ok.

Evidence used: distinct commit authors other than you (bots and the emails in
config.git_emails excluded), the remote owner vs config.git_logins, CODEOWNERS,
CONTRIBUTING. --plain-dir treats a non-git directory as the project root (only
when the user insists; nothing is classified then).`;

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

const BOT_RE = /\[bot\]|dependabot|github-actions|renovate|actions@github\.com|noreply@anthropic\.com/i;

export function classify(dir, { env = process.env } = {}) {
  const { config } = loadConfig(env);
  const top = git(['rev-parse', '--show-toplevel'], dir);
  if (!top) return { git: false, root: resolve(dir) };
  const root = resolve(top);
  const myEmails = new Set([git(['config', 'user.email'], root), ...(config.git_emails ?? [])].filter(Boolean).map((e) => e.toLowerCase()));
  const myLogins = new Set((config.git_logins ?? []).map((l) => l.toLowerCase()));
  for (const login of myLogins) myEmails.add(`${login}@users.noreply.github.com`);
  const log = git(['log', '--format=%ae\t%an', '-n', '2000'], root) ?? '';
  const authors = new Map();
  for (const line of log.split('\n').filter(Boolean)) {
    const [email, name] = line.split('\t');
    if (BOT_RE.test(line)) continue;
    const key = email.toLowerCase();
    if (!authors.has(key)) authors.set(key, { email, name, commits: 0 });
    authors.get(key).commits++;
  }
  const others = [...authors.values()].filter((a) => !myEmails.has(a.email.toLowerCase()) && !isNoreplyOf(a.email, myLogins));
  const remote = git(['remote', 'get-url', 'origin'], root);
  const owner = remote ? ownerOf(remote) : null;
  const ownerKnown = owner ? myLogins.has(owner.owner.toLowerCase()) : null;
  const codeowners = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'].filter((p) => existsSync(join(root, p)));
  const contributing = ['CONTRIBUTING.md', '.github/CONTRIBUTING.md', 'CONTRIBUTING'].filter((p) => existsSync(join(root, p)));

  const reasons = [];
  if (others.length) reasons.push(`${others.length} other author(s) in git log: ${others.slice(0, 5).map((a) => `${a.name} <${a.email}> (${a.commits})`).join(', ')}${others.length > 5 ? ', …' : ''}`);
  if (codeowners.length) reasons.push(`CODEOWNERS present: ${codeowners.join(', ')}`);
  if (owner && ownerKnown === false && myLogins.size) reasons.push(`remote owner "${owner.owner}" is not in config.git_logins (${[...myLogins].join(', ')})`);
  const hints = [];
  if (contributing.length) hints.push(`CONTRIBUTING present: ${contributing.join(', ')} (weak signal)`);
  if (owner && !myLogins.size) hints.push(`remote owner "${owner.owner}" — add config.git_logins to let the gate use it`);
  const verdict = reasons.length ? 'shared' : 'personal';
  return {
    git: true,
    root,
    verdict,
    reasons,
    hints,
    evidence: {
      myEmails: [...myEmails],
      authors: [...authors.values()],
      otherAuthors: others,
      remote,
      owner,
      codeowners,
      contributing
    }
  };
}

function isNoreplyOf(email, logins) {
  const m = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email);
  return m ? logins.has(m[1].toLowerCase()) : false;
}

function ownerOf(remote) {
  const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote);
  const host = /@([^:/]+)[:/]/.exec(remote)?.[1] ?? /:\/\/([^/]+)\//.exec(remote)?.[1] ?? null;
  return m ? { host, owner: m[1], repo: m[2] } : null;
}

async function main(flags) {
  const dir = flags.dir ?? process.cwd();
  const c = classify(dir);
  if (!c.git) {
    if (flags['plain-dir']) return { ...c, proceed: true, mode: 'plain-dir', message: `not a git repository; plain-directory mode at ${c.root} (no classification, no shim guarantees)` };
    return { ...c, proceed: false, exitCode: EXIT.ERROR, message: `${c.root} is not inside a git repository — instructions-project works on repositories; rerun with --plain-dir only if the user insists` };
  }
  if (c.verdict === 'shared' && !flags['shared-ok']) {
    return { ...c, proceed: false, exitCode: EXIT.ERROR, message: `shared repository — stopping. Rerun with --shared-ok to authorize edits for this run only.` };
  }
  return { ...c, proceed: true, mode: c.verdict === 'shared' ? 'shared (authorized for this run)' : 'personal', message: `${c.verdict} repository at ${c.root}` };
}

function render(r) {
  const out = [r.message];
  if (r.git) {
    out.push(`verdict: ${r.verdict}`);
    for (const x of r.reasons) out.push(`  evidence: ${x}`);
    for (const x of r.hints) out.push(`  hint: ${x}`);
    out.push(`  authors: ${r.evidence.authors.length} (you: ${r.evidence.myEmails.join(', ') || 'unknown'})`);
    if (r.evidence.remote) out.push(`  remote: ${r.evidence.remote}`);
  }
  out.push(r.proceed ? 'proceed' : 'STOP');
  return out.join('\n');
}

if (isMain(import.meta.url)) {
  run({ spec: { dir: 'string', 'shared-ok': 'bool', 'plain-dir': 'bool' }, help: HELP, main, render });
}
