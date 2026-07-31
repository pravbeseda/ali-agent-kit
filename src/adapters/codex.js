import { join, resolve } from 'node:path';

/**
 * Codex loads skills from `$CODEX_HOME/skills` (that is where its own `.system`
 * skills live) and, additionally, from the shared `~/.agents/skills` directory.
 * We write to the Codex-owned dir only: the shared one is usually managed by a
 * different tool, and installing into both would give Codex two copies of every
 * `ali-*` skill.
 *
 * @type {import('./index.js').Adapter}
 */
export default {
  id: 'codex',
  label: 'Codex CLI',

  locations({ env, home }) {
    const configDir = env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(home, '.codex');
    return [{ configDir, skillsDir: join(configDir, 'skills') }];
  }
};
