// Shared between ali-instructions-global and ali-instructions-project.
// Claude Code auto memory: ~/.claude/projects/<slug>/memory/ — list dirs, map a
// slug back to a path (best effort: the slug is the path with separators
// replaced by "-", which is ambiguous for names containing "-", so we walk the
// filesystem to find a real directory that produces the slug), read files.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, sep, resolve } from 'node:path';
import { platform } from 'node:os';
import { fileInfo, readText } from './fsx.js';
import { agentDirs } from './paths.js';

export function slugOf(absPath) {
  // Claude Code's own example: /home/user/work/my-repo -> -home-user-work-my-repo
  return absPath.replace(/[\\/:]+/g, '-').replace(/-+$/, '');
}

/** Try to find an existing directory whose slug equals `slug`. Returns path or null. */
export function resolveSlug(slug, { fsExists = existsSync, isDir = (p) => statSync(p).isDirectory(), root } = {}) {
  const parts = slug.replace(/^-/, '').split('-');
  const win = platform() === 'win32' && !root;
  const base = root ?? (win ? null : sep);
  // Windows slug: "C--Users-me-repo" (drive colon becomes a dash too) — treat first part as drive.
  const start = win ? `${parts[0]}:${sep}` : base;
  const rest = win ? parts.slice(win && parts[1] === '' ? 2 : 1) : parts;
  const search = (dir, idx) => {
    if (idx === rest.length) return dir;
    for (let take = 1; idx + take <= rest.length; take++) {
      const candidate = join(dir, rest.slice(idx, idx + take).join('-'));
      if (fsExists(candidate) && isDir(candidate)) {
        const found = search(candidate, idx + take);
        if (found) return found;
      }
    }
    return null;
  };
  return search(start, 0);
}

/** All memory dirs under the Claude projects dir, with a resolved project path when possible. */
export function listMemoryDirs(env = process.env) {
  const projects = join(agentDirs(env).claude, 'projects');
  if (!existsSync(projects)) return [];
  const out = [];
  for (const slug of readdirSync(projects).sort()) {
    const dir = join(projects, slug, 'memory');
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => fileInfo(join(dir, f)));
    const projectPath = resolveSlug(slug);
    out.push({
      slug,
      dir,
      projectPath,
      projectExists: !!projectPath,
      indexPath: join(dir, 'MEMORY.md'),
      hasIndex: existsSync(join(dir, 'MEMORY.md')),
      files
    });
  }
  return out;
}

/** The memory dir for a given project path (may not exist). */
export function memoryDirFor(projectPath, env = process.env) {
  return join(agentDirs(env).claude, 'projects', slugOf(resolve(projectPath)), 'memory');
}

/** Split a memory topic file into frontmatter (kept verbatim) and body. */
export function splitFrontmatter(text) {
  const m = /^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/.exec(text);
  return m ? { frontmatter: m[1], body: m[2] } : { frontmatter: '', body: text };
}

export function readMemoryFile(path) {
  const { text } = readText(path);
  const { frontmatter, body } = splitFrontmatter(text);
  const fields = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return { path, frontmatter, fields, body };
}
