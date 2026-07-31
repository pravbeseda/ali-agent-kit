import claude from './claude.js';
import copilot from './copilot.js';
import codex from './codex.js';

/**
 * An agent adapter ("plugin"). Add a new agent by dropping a file next to this
 * one and listing it here — nothing else in the codebase knows about agents.
 *
 * @typedef {object} Adapter
 * @property {string} id            cli name, e.g. `claude`
 * @property {string} label         human name, e.g. `Claude Code`
 * @property {(env: NodeJS.ProcessEnv, home: string) => string} configDir
 *           agent config root; its existence means "this agent is installed"
 * @property {(configDir: string) => string} skillsDir  where skills live
 * @property {(skill: import('../skills.js').Skill) => import('../skills.js').Skill} [transform]
 *           optional per-agent tweak of a skill before it is written
 */

/** @type {Adapter[]} */
export const adapters = [claude, copilot, codex];

export function getAdapter(id) {
  return adapters.find((a) => a.id === id);
}
