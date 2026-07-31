import { join, resolve } from 'node:path';

/** @type {import('./index.js').Adapter} */
export default {
  id: 'claude-code',
  aliases: ['claude'],
  label: 'Claude Code',

  locations({ env, home }) {
    const configDir = env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(home, '.claude');
    return [{ configDir, skillsDir: join(configDir, 'skills') }];
  }
};
