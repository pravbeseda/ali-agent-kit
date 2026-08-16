// Shared between ali-instructions-global and ali-instructions-project.
// The two skills duplicate their shared files (this repo has no shared-asset
// mechanism). This check finds the sibling skill and compares checksums, so a
// change made in one copy and not the other is reported instead of silently
// diverging. `test/instructions-skills.test.js` enforces the same in the repo.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256File } from './fsx.js';

/** Files that must be byte-identical in both skills (relative to the skill dir). */
export const SHARED = [
  'scripts/lib',
  'scripts/restore.js',
  'scripts/report.js',
  'scripts/dupes.js',
  'scripts/review.js',
  'references/rubric.md',
  'references/report-template.md',
  'references/config-schema.md',
  'references/review-prompt.md',
  'references/surfaces.md'
];

export function skillDir() {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

const NAMES = ['instructions-global', 'instructions-project'];

/** The other skill's dir, whether installed (ali- prefix) or in the source repo. */
export function siblingDir(self = skillDir()) {
  const name = basename(self);
  const bare = name.replace(/^ali-/, '');
  const other = NAMES.find((n) => n !== bare);
  if (!other) return null;
  const parent = dirname(self);
  for (const candidate of [join(parent, name.replace(bare, other)), join(parent, other), join(parent, `ali-${other}`)]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function listShared(root) {
  const out = [];
  for (const rel of SHARED) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (statSync(join(p, f)).isFile()) out.push(relative(root, join(p, f)).split(sep).join('/'));
    } else out.push(rel);
  }
  return out;
}

/** { ok, sibling, differences: [relative paths] } — ok when no sibling is installed, too. */
export function selfCheck(self = skillDir()) {
  const sibling = siblingDir(self);
  if (!sibling) return { ok: true, sibling: null, differences: [], note: 'sibling skill not found — nothing to compare' };
  const files = new Set([...listShared(self), ...listShared(sibling)]);
  const differences = [];
  for (const rel of files) {
    const a = join(self, rel);
    const b = join(sibling, rel);
    if (!existsSync(a) || !existsSync(b) || sha256File(a) !== sha256File(b)) differences.push(rel);
  }
  return { ok: differences.length === 0, sibling, differences };
}
