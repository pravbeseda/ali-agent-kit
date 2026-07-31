import { join } from 'node:path';

/** @type {import('./index.js').Adapter} */
export default {
  id: 'copilot',
  label: 'GitHub Copilot CLI',
  configDir: (env, home) => env.COPILOT_CONFIG_DIR || join(home, '.copilot'),
  skillsDir: (configDir) => join(configDir, 'skills')
};
