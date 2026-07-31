import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PREFIX, skillsSourceDir } from './config.js';

/**
 * A skill as it lives in this repo.
 * @typedef {object} Skill
 * @property {string} sourceName  name in the repo, e.g. `review-branch`
 * @property {string} name        published name, e.g. `ali-review-branch`
 * @property {string} description from frontmatter, may be ''
 * @property {{path: string, content: Buffer|string}[]} files  paths are relative to the skill dir
 */

export function prefixed(name) {
  return name.startsWith(PREFIX) ? name : PREFIX + name;
}

/** Read all skills from `skills/`. Accepts `foo.md` and `foo/SKILL.md` layouts. */
export function loadSkills(dir = skillsSourceDir) {
  if (!existsSync(dir)) return [];

  const skills = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      const skillFile = ['SKILL.md', 'skill.md'].find((f) =>
        existsSync(join(full, f))
      );
      if (!skillFile) continue;
      skills.push(buildSkill(entry, readdirFiles(full), skillFile));
    } else if (entry.toLowerCase().endsWith('.md')) {
      const sourceName = entry.replace(/\.md$/i, '');
      skills.push(
        buildSkill(
          sourceName,
          [{ path: 'SKILL.md', content: readFileSync(full) }],
          'SKILL.md'
        )
      );
    }
  }
  return skills;
}

function readdirFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      if (entry === '.DS_Store') continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else
        out.push({
          path: relative(dir, full).split(sep).join('/'),
          content: readFileSync(full)
        });
    }
  };
  walk(dir);
  return out;
}

function buildSkill(sourceName, files, skillFileName) {
  const name = prefixed(sourceName);
  const index = files.findIndex((f) => f.path === skillFileName);
  const raw = files[index].content.toString('utf8');
  const { description } = parseFrontmatter(raw);

  const rewritten = files.slice();
  rewritten[index] = {
    path: 'SKILL.md',
    content: rewriteFrontmatter(raw, { name, description })
  };

  return { sourceName, name, description, files: rewritten };
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseFrontmatter(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { fields: {}, body: raw, description: '' };

  /** @type {Record<string, string>} */
  const fields = {};
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      fields[key] = kv[2].trim();
    } else if (key && /^\s+\S/.test(line)) {
      // folded multi-line value
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return { fields, body: raw.slice(match[0].length), description: unquote(fields.description ?? '') };
}

function unquote(value) {
  return value.replace(/^["'](.*)["']$/s, '$1');
}

/** Force `name` (prefixed) into the frontmatter, keeping every other field intact. */
export function rewriteFrontmatter(raw, { name, description }) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    const head = ['---', `name: ${name}`];
    if (description) head.push(`description: ${description}`);
    head.push('---', '');
    return `${head.join('\n')}\n${raw}`;
  }

  const lines = match[1].split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    if (/^name:\s*/.test(line)) {
      replaced = true;
      return `name: ${name}`;
    }
    return line;
  });
  if (!replaced) next.unshift(`name: ${name}`);

  return `---\n${next.join('\n')}\n---\n${raw.slice(match[0].length)}`;
}
