import { readdirSync, readFileSync, lstatSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { INSTALL_NOTICE, MARKER, NOTICE_SENTINEL, PREFIX, skillsSourceDir } from './config.js';
import { getAdapter } from './adapters/index.js';

/**
 * A skill as it lives in this repo.
 * @typedef {object} Skill
 * @property {string} sourceName  name in the repo, e.g. `review-branch`
 * @property {string} name        published name, e.g. `ali-review-branch`
 * @property {string} description from frontmatter
 * @property {string[]|null} agents adapter ids this skill installs into; null means every agent
 * @property {{path: string, content: Buffer|string, mode: number}[]} files
 *           paths relative to the skill dir; `mode` keeps the executable bit of
 *           bundled scripts, which a plain write would drop
 */

const SOURCE_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME_LENGTH = 64;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export class SkillError extends Error {}

export function prefixed(name) {
  return name.startsWith(PREFIX) ? name : PREFIX + name;
}

/**
 * Read and validate all skills in `skills/`. Accepts `foo.md` and `foo/SKILL.md`.
 * Throws {@link SkillError} on anything that would produce a broken install —
 * `ali-agent-kit validate` runs this, and so does `prepublishOnly`.
 */
export function loadSkills(dir = skillsSourceDir) {
  if (!existsSync(dir)) return [];

  const seen = new Map();
  const skills = [];

  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const stat = lstatSync(full);

    if (stat.isSymbolicLink()) {
      throw new SkillError(`${full}: symbolic links are not supported`);
    }

    let sourceName;
    let files;
    if (stat.isDirectory()) {
      if (!existsSync(join(full, 'SKILL.md'))) continue;
      sourceName = entry;
      files = readSkillDir(full);
    } else if (entry.toLowerCase().endsWith('.md')) {
      sourceName = entry.slice(0, -3);
      files = [{ path: 'SKILL.md', content: readFileSync(full), mode: stat.mode & 0o777 }];
    } else {
      continue;
    }

    const previous = seen.get(sourceName);
    if (previous) {
      throw new SkillError(
        `${full}: duplicate skill "${sourceName}" (already defined by ${previous}) — use either the .md file or the directory`
      );
    }
    seen.set(sourceName, full);
    skills.push(buildSkill(sourceName, files, full));
  }

  return skills;
}

function readSkillDir(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      if (entry === '.DS_Store') continue;
      const full = join(current, entry);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        throw new SkillError(`${full}: symbolic links are not supported`);
      }
      if (entry === MARKER) {
        throw new SkillError(`${full}: ${MARKER} is reserved for installed-skill ownership`);
      }
      if (stat.isDirectory()) walk(full);
      else
        out.push({
          path: relative(dir, full).split(sep).join('/'),
          content: readFileSync(full),
          mode: stat.mode & 0o777
        });
    }
  };
  walk(dir);
  return out;
}

function buildSkill(sourceName, files, sourcePath) {
  if (!SOURCE_NAME_RE.test(sourceName)) {
    throw new SkillError(
      `${sourcePath}: skill name must be lowercase letters, digits and single hyphens`
    );
  }
  if (sourceName.startsWith(PREFIX)) {
    throw new SkillError(
      `${sourcePath}: source names must not carry the reserved "${PREFIX}" prefix — it is added on install`
    );
  }

  const name = prefixed(sourceName);
  if (name.length > MAX_NAME_LENGTH) {
    throw new SkillError(`${sourcePath}: installed name "${name}" exceeds ${MAX_NAME_LENGTH} characters`);
  }

  const index = files.findIndex((f) => f.path === 'SKILL.md');
  // A leading BOM would hide the frontmatter from every parser downstream.
  const raw = files[index].content.toString('utf8').replace(/^\uFEFF/, '');
  const { fields, description } = parseFrontmatter(raw);

  if (!FRONTMATTER_RE.test(raw)) {
    throw new SkillError(`${sourcePath}: SKILL.md is missing YAML frontmatter`);
  }
  if (fields.name === undefined) {
    throw new SkillError(`${sourcePath}: frontmatter must contain "name"`);
  }
  if (unquote(fields.name) !== sourceName) {
    throw new SkillError(
      `${sourcePath}: frontmatter name "${unquote(fields.name)}" must match the source name "${sourceName}"`
    );
  }
  if (!description) {
    throw new SkillError(
      `${sourcePath}: frontmatter must contain a non-empty "description" — agents use it to decide when to trigger the skill`
    );
  }

  if (raw.includes(NOTICE_SENTINEL)) {
    throw new SkillError(
      `${sourcePath}: SKILL.md already carries the managed-file notice — it is added on install, keep it out of the source`
    );
  }

  const agents = parseAgents(fields.agents, sourcePath);

  const rewritten = files.slice();
  rewritten[index] = {
    path: 'SKILL.md',
    content: withInstallNotice(
      rewriteFrontmatter(agents ? dropFrontmatterKey(raw, 'agents') : raw, { name, description })
    ),
    mode: files[index].mode
  };

  return { sourceName, name, description, agents, files: rewritten };
}

/**
 * `agents: claude, codex` scopes a skill to the agents that can actually run it
 * — a skill built on one host's subagents is dead weight everywhere else.
 * Ids and aliases both work and are resolved to ids here, so the installer
 * compares them directly. Absent means every agent, which is the ordinary case.
 */
function parseAgents(value, sourcePath) {
  if (value === undefined) return null;

  const names = unquote(value)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (!names.length) {
    throw new SkillError(
      `${sourcePath}: "agents" must name at least one agent, or be left out to install everywhere`
    );
  }

  const ids = [];
  for (const name of names) {
    const adapter = getAdapter(name);
    if (!adapter) {
      throw new SkillError(
        `${sourcePath}: unknown agent "${name}" in "agents" — a typo here would install the skill nowhere`
      );
    }
    if (!ids.includes(adapter.id)) ids.push(adapter.id);
  }
  return ids;
}

/**
 * Drop one key, and the folded lines that belong to it, from the frontmatter.
 * `agents` tells this installer where to write; the agent reading the installed
 * skill has no use for it.
 */
function dropFrontmatterKey(raw, key) {
  const eol = eolOf(raw);
  const match = raw.match(FRONTMATTER_RE);
  const kept = [];
  let dropping = false;

  for (const line of match[1].split(/\r?\n/)) {
    if (new RegExp(`^${key}\\s*:`).test(line)) {
      dropping = true;
      continue;
    }
    if (dropping && /^\s+\S/.test(line)) continue;
    dropping = false;
    kept.push(line);
  }

  return `---${eol}${kept.join(eol)}${eol}---${eol}${raw.slice(match[0].length)}`;
}

/**
 * The line ending of the source's first line. Every line this module writes
 * follows it, so a CRLF skill does not come out of the installer with mixed
 * endings. Deliberately not "does a CRLF appear anywhere": an LF file with one
 * CRLF inside a fenced code block would then get a CRLF frontmatter and notice
 * wrapped around an LF body — the very thing this is meant to avoid.
 */
function eolOf(raw) {
  const firstBreak = raw.indexOf('\n');
  return firstBreak > 0 && raw[firstBreak - 1] === '\r' ? '\r\n' : '\n';
}

/**
 * Put the managed-file notice directly under the frontmatter, so it is the
 * first thing in the body. Takes `rewriteFrontmatter` output, which always has
 * frontmatter, and only ever runs on a source `buildSkill` has already rejected
 * if it carried a notice of its own — so neither case needs handling here.
 */
function withInstallNotice(raw) {
  const eol = eolOf(raw);
  const match = raw.match(FRONTMATTER_RE);
  // `\r?\n`, not `\n`: FRONTMATTER_RE accepts CRLF sources, whose body starts
  // with `\r\n` and would keep every blank line the LF case drops.
  const body = raw.slice(match[0].length).replace(/^(\r?\n)+/, '');
  return `${match[0]}${eol}${INSTALL_NOTICE.replace(/\n/g, eol)}${eol}${body}`;
}

export function parseFrontmatter(raw) {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { fields: {}, body: raw, description: '' };

  /** @type {Record<string, string>} */
  const fields = {};
  let key = null;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
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
  const eol = eolOf(raw);
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    const head = ['---', `name: ${name}`];
    if (description) head.push(`description: ${description}`);
    head.push('---', '');
    return `${head.join(eol)}${eol}${raw}`;
  }

  const lines = match[1].split(/\r?\n/);
  let replaced = false;
  const next = lines.map((line) => {
    if (/^name\s*:\s*/.test(line)) {
      replaced = true;
      return `name: ${name}`;
    }
    return line;
  });
  if (!replaced) next.unshift(`name: ${name}`);

  return `---${eol}${next.join(eol)}${eol}---${eol}${raw.slice(match[0].length)}`;
}
