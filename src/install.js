import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { MARKER, MARKER_SCHEMA_VERSION, PREFIX, pkg } from './config.js';
import { adapters, resolveAdapters } from './adapters/index.js';
import { loadSkills } from './skills.js';

/**
 * Expand every selected adapter into the locations that actually exist.
 * @returns {{detected: object[], skipped: object[]}}
 */
export function detectAgents({ env = process.env, home = homedir(), only = null } = {}) {
  const selected = only ? resolveAdapters(only) : adapters;
  const detected = [];
  const skipped = [];

  for (const adapter of selected) {
    const locations = adapter.locations({ env, home });
    if (!Array.isArray(locations) || !locations.length) {
      throw new Error(`Agent "${adapter.id}" returned no locations`);
    }

    const found = locations.filter((location) => {
      if (!location?.configDir || !location?.skillsDir) {
        throw new Error(`Agent "${adapter.id}" returned an invalid location`);
      }
      return isDirectory(location.configDir);
    });

    if (found.length) detected.push(...found.map((location) => ({ adapter, ...location })));
    else {
      // Report every path we looked at, not just the first, or an agent with
      // several profiles looks like it was searched for in one place only.
      const configDirs = locations.map((location) => location.configDir);
      skipped.push({ adapter, configDir: configDirs[0], configDirs });
    }
  }

  return { detected, skipped };
}

/** lstat that tolerates a path disappearing under us mid-run. */
function safeLstat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function isDirectory(path) {
  return safeLstat(path)?.isDirectory() ?? false;
}

function readMarker(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, MARKER), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Ownership is decided by the package name plus a marker layout we can still
 * read: our own older markers stay ours, so bumping the schema updates installs
 * instead of turning every skill on every machine into a conflict. A newer
 * layout than this release knows about is left alone.
 */
function isOurs(dir) {
  const marker = readMarker(dir);
  if (marker?.packageName !== pkg.name) return false;
  const schema = marker.schemaVersion ?? 0;
  return Number.isInteger(schema) && schema <= MARKER_SCHEMA_VERSION;
}

/** Skills previously installed by this package into `skillsDir`. */
export function installedSkills(skillsDir) {
  if (!isDirectory(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((entry) => entry.startsWith(PREFIX))
    .filter((entry) => {
      const full = join(skillsDir, entry);
      const stat = safeLstat(full);
      return stat?.isDirectory() === true && isOurs(full);
    })
    .sort();
}

// Only ever matches what this package writes: skill names are kebab-case, so a
// dot in the middle cannot come from us, and someone else's dotted temp dir must
// not be swept — let alone restored into a skill that never existed.
const LEFTOVER_RE = new RegExp(`^\\.(${PREFIX}[a-z0-9-]+)\\.(staging|backup)-[0-9a-f-]{36}$`);

/**
 * Clean up after a run that was killed mid-swap. A staging dir is always
 * garbage; a backup dir means the destination was moved aside and never
 * replaced, so restore it when the destination is missing.
 *
 * @returns {string[]} names of skills restored from a backup
 */
function reclaimLeftovers(skillsDir, { dryRun = false } = {}) {
  if (!isDirectory(skillsDir)) return [];
  const restored = [];

  for (const entry of readdirSync(skillsDir).sort()) {
    const match = entry.match(LEFTOVER_RE);
    if (!match) continue;

    const [, name, kind] = match;
    const leftover = join(skillsDir, entry);
    const destination = join(skillsDir, name);
    const recoverable = kind === 'backup' && !existsSync(destination);

    if (recoverable) restored.push(name);
    if (dryRun) continue;
    if (recoverable) renameSync(leftover, destination);
    else rmSync(leftover, { recursive: true, force: true });
  }

  return restored;
}

/**
 * Write one skill so the destination is never left half-written: materialize into
 * a staging dir, swap it in with rename(), and roll the previous version back if
 * the swap fails.
 */
function writeSkillAtomically(skillsDir, skill) {
  const destination = join(skillsDir, skill.name);
  const nonce = randomUUID();
  const staging = join(skillsDir, `.${skill.name}.staging-${nonce}`);
  const backup = join(skillsDir, `.${skill.name}.backup-${nonce}`);
  const hadPrevious = existsSync(destination);

  try {
    for (const file of skill.files) {
      const target = join(staging, file.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content);
      // chmod rather than the write mode option: that one is masked by umask,
      // which would silently drop the executable bit of bundled scripts.
      if (file.mode !== undefined) chmodSync(target, file.mode);
    }
    writeFileSync(
      join(staging, MARKER),
      `${JSON.stringify(
        {
          schemaVersion: MARKER_SCHEMA_VERSION,
          packageName: pkg.name,
          packageVersion: pkg.version,
          sourceName: skill.sourceName,
          installedName: skill.name,
          installedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`
    );

    if (hadPrevious) renameSync(destination, backup);
    try {
      renameSync(staging, destination);
    } catch (error) {
      if (hadPrevious) renameSync(backup, destination);
      throw error;
    }
    if (hadPrevious) rmSync(backup, { recursive: true, force: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Whether a skill's `agents:` scope lets it into this agent. No scope, every agent. */
function appliesTo(skill, adapter) {
  return !skill.agents || skill.agents.includes(adapter.id);
}

/** Apply an adapter's transform and check that it returned a usable skill. */
function reshape(target, skill) {
  const shaped = target.adapter.transform(skill);
  if (!shaped?.name?.startsWith(PREFIX) || !shaped.files?.length) {
    throw new Error(
      `Agent "${target.adapter.id}": transform() returned an invalid skill for "${skill.name}" — it must keep the "${PREFIX}" prefix and at least one file`
    );
  }
  return shaped;
}

/** Plan one location: what to write, what to prune, what we must not touch. */
function inspect(target, skills, prune) {
  const wanted = new Set(skills.map((s) => s.name));
  const added = [];
  const updated = [];
  const conflicts = [];
  const removed = [];

  if (existsSync(target.skillsDir) && !isDirectory(target.skillsDir)) {
    conflicts.push({ name: null, path: target.skillsDir, reason: 'exists but is not a directory' });
    return { added, updated, removed, conflicts };
  }

  for (const skill of skills) {
    const destination = join(target.skillsDir, skill.name);
    if (!existsSync(destination)) {
      added.push(skill.name);
      continue;
    }
    if (lstatSync(destination).isSymbolicLink() || !isDirectory(destination)) {
      conflicts.push({ name: skill.name, path: destination, reason: 'is not a managed directory' });
      continue;
    }
    if (!isOurs(destination)) {
      conflicts.push({ name: skill.name, path: destination, reason: `is not owned by ${pkg.name}` });
      continue;
    }
    updated.push(skill.name);
  }

  if (prune) {
    for (const name of installedSkills(target.skillsDir)) {
      if (!wanted.has(name)) removed.push(name);
    }
  }

  return { added, updated, removed, conflicts };
}

/**
 * Install/update every skill into every detected agent that its `agents:` scope
 * allows, and drop the ones that agent should no longer hold — removed from the
 * package, or scoped away. Same entry point for install and update.
 */
export function sync({
  skills = loadSkills(),
  only = null,
  dryRun = false,
  env = process.env,
  home = homedir(),
  prune = true
} = {}) {
  const { detected, skipped } = detectAgents({ env, home, only });
  const results = [];

  for (const target of detected) {
    // Scope first, so a skill this agent is not meant to have is absent from the
    // plan — which is also what makes pruning drop a copy an earlier version,
    // or a wider scope, installed here.
    const scoped = skills.filter((skill) => appliesTo(skill, target.adapter));
    // Reshape next: the plan below must reason about the paths we will really
    // write, or a renaming transform would make us prune what we just installed.
    const shaped = target.adapter.transform ? scoped.map((skill) => reshape(target, skill)) : scoped;
    const restored = reclaimLeftovers(target.skillsDir, { dryRun });
    const plan = inspect(target, shaped, prune);
    const skip = new Set(plan.conflicts.map((conflict) => conflict.name));
    const blocked = plan.conflicts.some((conflict) => conflict.name === null);

    if (!dryRun && !blocked) {
      mkdirSync(target.skillsDir, { recursive: true });
      for (const skill of shaped) {
        if (skip.has(skill.name)) continue;
        writeSkillAtomically(target.skillsDir, skill);
      }
      for (const name of plan.removed) {
        rmSync(join(target.skillsDir, name), { recursive: true, force: true });
      }
    }

    results.push({ ...target, ...plan, restored });
  }

  return {
    agents: results,
    skipped,
    skills: skills.map((s) => s.name),
    conflicts: results.flatMap((r) => r.conflicts)
  };
}

/** Remove every skill this package installed, from every detected agent. */
export function uninstall({ only = null, dryRun = false, env = process.env, home = homedir() } = {}) {
  const { detected, skipped } = detectAgents({ env, home, only });
  const agents = [];

  for (const target of detected) {
    reclaimLeftovers(target.skillsDir, { dryRun });
    const removed = installedSkills(target.skillsDir);
    if (!dryRun) {
      for (const name of removed) rmSync(join(target.skillsDir, name), { recursive: true, force: true });
    }
    agents.push({ ...target, removed });
  }

  return { agents, skipped };
}
