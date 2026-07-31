import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const pkg = JSON.parse(
  readFileSync(join(packageRoot, 'package.json'), 'utf8')
);

/** Every published skill gets this prefix. `review-branch` -> `ali-review-branch`. */
export const PREFIX = 'ali-';

/** Marker file dropped into each installed skill, so updates only touch what we own. */
export const MARKER = '.ali-agent-kit.json';

/** Bump when the marker layout changes; older markers stop counting as ours. */
export const MARKER_SCHEMA_VERSION = 1;

/** Source dir inside the package that holds the skills. */
export const skillsSourceDir = join(packageRoot, 'skills');
