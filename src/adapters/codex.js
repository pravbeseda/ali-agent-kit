import { join } from 'node:path';

/** @type {import('./index.js').Adapter} */
export default {
  id: 'codex',
  label: 'Codex CLI',
  configDir: (env, home) => env.CODEX_HOME || join(home, '.codex'),
  skillsDir: (configDir) => join(configDir, 'skills')
};
