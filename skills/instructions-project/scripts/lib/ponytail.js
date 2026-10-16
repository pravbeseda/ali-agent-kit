// Shared between ali-instructions-global and ali-instructions-project.
// The optional Ponytail rules block: rules curated from upstream ponytail into
// references/ponytail-rules.md, rendered without the rules a machine skips,
// and the state of the block in a master for this machine's config.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, findBlock, PONYTAIL } from './markers.js';

const CURATED_RE = /<!--\s*curated: source=(\S+) ref=(\S+) curated=(\S+)\s*-->/;
const RULE_RE = /^- \[([a-z0-9-]+)\] (.+)$/;

export function rulesPath(referencesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'references')) {
  return join(referencesDir, 'ponytail-rules.md');
}

/** { source, ref, curated, rules: [{ id, text }] } */
export function readRules(path = rulesPath()) {
  const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const header = CURATED_RE.exec(text);
  if (!header) throw new Error(`${path}: no "<!-- curated: … -->" header`);
  const rules = text
    .split('\n')
    .map((line) => RULE_RE.exec(line))
    .filter(Boolean)
    .map((m) => ({ id: m[1], text: m[2] }));
  return { source: header[1], ref: header[2], curated: header[3], rules };
}

/** Block body as it goes into the master, without the skipped rules. */
export function renderBody({ rules }, { skip = [] } = {}) {
  const lines = rules.filter((r) => !skip.includes(r.id)).map((r) => `- ${r.text}`);
  return [
    '## Ponytail rules',
    '',
    ...lines,
    '',
    '_Source: https://github.com/DietrichGebert/ponytail (MIT), curated by ali-agent-kit. Managed block: edit outside the markers; turn a rule off with `ponytail.skip` in config.json._'
  ].join('\n');
}

/**
 * State of the block in `masterText` for this machine's `enabled` setting:
 *   undecided (enabled is null) | off | remove (enabled is false)
 *   absent | current | stale | local-edit | broken (enabled is true)
 */
export function classify(masterText, rendered, enabled) {
  const found = findBlock(masterText ?? '', PONYTAIL);
  if (enabled === null || enabled === undefined) return { state: 'undecided', block: found };
  if (found?.broken) return { state: 'broken', block: found };
  if (enabled === false) return { state: found ? 'remove' : 'off', block: found };
  if (!found) return { state: 'absent', block: null };
  if (found.bodyHash !== found.header.hash) return { state: 'local-edit', block: found };
  return { state: found.header.hash === contentHash(rendered) ? 'current' : 'stale', block: found };
}
