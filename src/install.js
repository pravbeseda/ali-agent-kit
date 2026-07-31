import {
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
    else skipped.push({ adapter, configDir: locations[0].configDir });
  }

  return { detected, skipped };
}

function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function readMarker(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, MARKER), 'utf8'));
  } catch {
    return null;
  }
}

function isOurs(dir) {
  const marker = readMarker(dir);
  return marker?.packageName === pkg.name && marker?.schemaVersion === MARKER_SCHEMA_VERSION;
}

/** Skills previously installed by this package into `skillsDir`. */
export function installedSkills(skillsDir) {
  if (!isDirectory(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((entry) => entry.startsWith(PREFIX))
    .filter((entry) => {
      const full = join(skillsDir, entry);
      return !lstatSync(full).isSymbolicLink() && isDirectory(full) && isOurs(full);
    })
    .sort();
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
 * Install/update every skill into every detected agent and drop the ones that
 * were removed from the package. Same entry point for install and update.
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
    const plan = inspect(target, skills, prune);
    const skip = new Set(plan.conflicts.map((conflict) => conflict.name));
    const blocked = plan.conflicts.some((conflict) => conflict.name === null);

    if (!dryRun && !blocked) {
      mkdirSync(target.skillsDir, { recursive: true });
      for (const skill of skills) {
        if (skip.has(skill.name)) continue;
        writeSkillAtomically(target.skillsDir, target.adapter.transform ? target.adapter.transform(skill) : skill);
      }
      for (const name of plan.removed) {
        rmSync(join(target.skillsDir, name), { recursive: true, force: true });
      }
    }

    results.push({ ...target, ...plan });
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
    const removed = installedSkills(target.skillsDir);
    if (!dryRun) {
      for (const name of removed) rmSync(join(target.skillsDir, name), { recursive: true, force: true });
    }
    agents.push({ ...target, removed });
  }

  return { agents, skipped };
}
