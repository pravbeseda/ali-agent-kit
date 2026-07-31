import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { MARKER, PREFIX, pkg } from './config.js';
import { adapters } from './adapters/index.js';
import { loadSkills } from './skills.js';

/** Adapters whose agent is actually installed on this machine. */
export function detectAgents({ env = process.env, home = homedir(), only = null } = {}) {
  return adapters
    .filter((a) => (only ? only.includes(a.id) : true))
    .map((a) => {
      const configDir = a.configDir(env, home);
      return {
        adapter: a,
        configDir,
        skillsDir: a.skillsDir(configDir),
        present: existsSync(configDir)
      };
    });
}

function markerPath(dir) {
  return join(dir, MARKER);
}

function isOurs(dir) {
  try {
    const data = JSON.parse(readFileSync(markerPath(dir), 'utf8'));
    return data.package === pkg.name;
  } catch {
    return false;
  }
}

/** Skills previously installed by this package into `skillsDir`. */
export function installedSkills(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir)
    .filter((entry) => entry.startsWith(PREFIX))
    .filter((entry) => {
      const full = join(skillsDir, entry);
      return statSync(full).isDirectory() && isOurs(full);
    });
}

function writeSkill(skillsDir, skill) {
  const target = join(skillsDir, skill.name);
  rmSync(target, { recursive: true, force: true });
  for (const file of skill.files) {
    const dest = join(target, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, file.content);
  }
  writeFileSync(
    markerPath(target),
    `${JSON.stringify(
      {
        package: pkg.name,
        version: pkg.version,
        skill: skill.name,
        source: skill.sourceName,
        installedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`
  );
  return target;
}

/**
 * Install/update all repo skills into every detected agent and delete the ones
 * that were removed from the repo. Same entry point for install and update.
 *
 * @returns {{agents: object[], skipped: object[], skills: string[]}}
 */
export function sync({
  skills = loadSkills(),
  only = null,
  dryRun = false,
  env = process.env,
  home = homedir(),
  prune = true
} = {}) {
  const detected = detectAgents({ env, home, only });
  const wanted = new Set(skills.map((s) => s.name));
  const results = [];

  for (const agent of detected.filter((a) => a.present)) {
    const { skillsDir } = agent;
    const installedBefore = installedSkills(skillsDir);
    const added = [];
    const updated = [];
    const removed = [];
    const conflicts = [];

    for (const skill of skills) {
      const shaped = agent.adapter.transform ? agent.adapter.transform(skill) : skill;
      const target = join(skillsDir, shaped.name);
      const exists = existsSync(target);

      if (exists && !isOurs(target)) {
        conflicts.push(shaped.name);
        continue;
      }
      if (!dryRun) {
        mkdirSync(skillsDir, { recursive: true });
        writeSkill(skillsDir, shaped);
      }
      (exists ? updated : added).push(shaped.name);
    }

    if (prune) {
      for (const name of installedBefore) {
        if (wanted.has(name)) continue;
        if (!dryRun) rmSync(join(skillsDir, name), { recursive: true, force: true });
        removed.push(name);
      }
    }

    results.push({ ...agent, added, updated, removed, conflicts });
  }

  return {
    agents: results,
    skipped: detected.filter((a) => !a.present),
    skills: [...wanted]
  };
}

/** Remove every skill this package installed, from every detected agent. */
export function uninstall({ only = null, dryRun = false, env = process.env, home = homedir() } = {}) {
  const results = [];
  for (const agent of detectAgents({ env, home, only }).filter((a) => a.present)) {
    const removed = installedSkills(agent.skillsDir);
    if (!dryRun) {
      for (const name of removed) {
        rmSync(join(agent.skillsDir, name), { recursive: true, force: true });
      }
    }
    results.push({ ...agent, removed });
  }
  return { agents: results };
}
