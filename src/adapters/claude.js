import { join } from 'node:path';

/** @type {import('./index.js').Adapter} */
export default {
  id: 'claude',
  label: 'Claude Code',
  configDir: (env, home) => env.CLAUDE_CONFIG_DIR || join(home, '.claude'),
  skillsDir: (configDir) => join(configDir, 'skills')
};
