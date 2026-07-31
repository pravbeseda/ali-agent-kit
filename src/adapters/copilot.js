import { join, resolve } from 'node:path';

/** @type {import('./index.js').Adapter} */
export default {
  id: 'copilot',
  label: 'GitHub Copilot CLI',

  locations({ env, home }) {
    const configDir = env.COPILOT_CONFIG_DIR
      ? resolve(env.COPILOT_CONFIG_DIR)
      : join(home, '.copilot');
    return [{ configDir, skillsDir: join(configDir, 'skills') }];
  }
};
