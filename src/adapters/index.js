import claude from './claude.js';
import copilot from './copilot.js';
import codex from './codex.js';

/**
 * An agent adapter ("plugin"). Add a new agent by dropping a file next to this
 * one and listing it below — nothing else in the codebase knows about agents.
 *
 * @typedef {object} Location
 * @property {string} configDir  its existence means "this agent is installed"; never created by us
 * @property {string} skillsDir  where skills are written; created only if configDir exists
 *
 * @typedef {object} Adapter
 * @property {string} id                 cli name, lowercase kebab-case, e.g. `claude-code`
 * @property {string} label              human name, e.g. `Claude Code`
 * @property {string[]} [aliases]        extra cli names, e.g. `claude`
 * @property {(ctx: {env: NodeJS.ProcessEnv, home: string}) => Location[]} locations
 *           one entry per profile the agent supports; every existing one is synced
 * @property {(skill: import('../skills.js').Skill) => import('../skills.js').Skill} [transform]
 *           optional per-agent reshaping of a skill before it is written
 */

const ID_RE = /^[a-z][a-z0-9-]*$/;

/** @type {Adapter[]} */
export const adapters = [claude, copilot, codex].map(validateAdapter);

function validateAdapter(adapter) {
  const where = adapter?.id ?? 'adapter';
  if (!adapter || typeof adapter !== 'object') throw new Error(`${where}: must export an object`);
  if (!ID_RE.test(adapter.id ?? '')) throw new Error(`${where}: invalid id`);
  if (!adapter.label?.trim()) throw new Error(`${where}: must define a label`);
  if (typeof adapter.locations !== 'function') throw new Error(`${where}: must define locations(ctx)`);
  if (adapter.aliases && !adapter.aliases.every((a) => ID_RE.test(a))) {
    throw new Error(`${where}: invalid aliases`);
  }
  return adapter;
}

const byName = new Map();
for (const adapter of adapters) {
  for (const name of [adapter.id, ...(adapter.aliases ?? [])]) {
    if (byName.has(name)) throw new Error(`Duplicate agent id or alias: ${name}`);
    byName.set(name, adapter);
  }
}

export function getAdapter(id) {
  return byName.get(id);
}

/** Resolve `--agent` values (ids, aliases, `all`) to adapters, deduplicated. */
export function resolveAdapters(requested = []) {
  if (!requested.length || requested.includes('all')) {
    if (requested.length > 1) throw new Error('Use "--agent all" on its own');
    return adapters;
  }

  const selected = [];
  for (const name of requested) {
    const adapter = byName.get(name);
    if (!adapter) {
      throw new Error(`Unknown agent "${name}". Known: ${adapters.map((a) => a.id).join(', ')}, all`);
    }
    if (!selected.includes(adapter)) selected.push(adapter);
  }
  return selected;
}
