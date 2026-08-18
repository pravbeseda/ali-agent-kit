// Shared between ali-instructions-global and ali-instructions-project.
// Turn a canonical text (the master, or AGENTS.md) into what one target file
// should contain: agent-specific blocks resolved, marker on top, frontmatter
// for VS Code-style instruction files, UTF-8/LF.

import { stripOnlyBlocks, generatedMarker, shimMarker, contentHash } from './markers.js';
import { normalizeText } from './fsx.js';

/**
 * Global targets. `agent` decides which `only:` blocks survive; `frontmatter`
 * adds `applyTo: "**"` for `*.instructions.md` readers.
 */
export const GLOBAL_TARGETS = {
  claude: { agent: 'claude', frontmatter: false },
  codex: { agent: 'codex', frontmatter: false },
  'copilot-cli': { agent: 'copilot', frontmatter: true },
  jetbrains: { agent: 'copilot', frontmatter: false }
};

/**
 * renderGlobal(masterText, { target, runId, masterLabel }) → { text, hash }
 * `hash` is the content hash of the rendered body (what the marker carries),
 * so drift can be checked against the file alone.
 */
export function renderGlobal(masterText, { target, runId, masterLabel = '~/.agent-instructions/global.md' }) {
  const spec = GLOBAL_TARGETS[target];
  if (!spec) throw new Error(`unknown target ${target}`);
  const body = normalizeText(stripOnlyBlocks(masterText, spec.agent));
  const hash = contentHash(body);
  const marker = generatedMarker({ skill: 'instructions-global', source: masterLabel, runId, hash });
  const head = spec.frontmatter ? `---\napplyTo: "**"\n---\n${marker}\n\n` : `${marker}\n\n`;
  return { text: head + body, hash, body };
}

// Claude Code resolves `@` imports against the shim's own directory (.claude/), hence `../`.
const SHIM_IMPORT = '@../AGENTS.md';
const STALE_SHIM_IMPORT = /^@AGENTS\.md\s*$/m;
const SHIM_IMPORT_LINE = /^@\.\.\/AGENTS\.md\s*$/m;

/** Which import a shim carries: `current`, `stale` (pre-fix `@AGENTS.md`, resolves to .claude/AGENTS.md) or `none`. */
export function shimImportState(text) {
  return SHIM_IMPORT_LINE.test(text) ? 'current' : STALE_SHIM_IMPORT.test(text) ? 'stale' : 'none';
}

/** The Claude Code shim for a project: marker + `@../AGENTS.md` + optional Claude-only content. */
export function renderShim(agentsText, { claudeOnly = '' } = {}) {
  const hash = contentHash(agentsText);
  const extra = claudeOnly.trim() ? `\n${normalizeText(claudeOnly)}` : '';
  return { text: `${shimMarker(hash)}\n${SHIM_IMPORT}\n${extra}`, hash };
}

/** `.github/copilot-instructions.md` as a generated copy of AGENTS.md (flag --copilot-copy). */
export function renderCopilotCopy(agentsText, { runId }) {
  const body = normalizeText(stripOnlyBlocks(agentsText, 'copilot'));
  const hash = contentHash(body);
  const marker = generatedMarker({
    skill: 'instructions-project',
    source: 'AGENTS.md',
    runId,
    hash,
    hint: 'edit AGENTS.md, then run instructions-project --sync-only'
  });
  return { text: `${marker}\n\n${body}`, hash, body };
}

/** Body of a rendered target with marker and frontmatter removed — for comparing hand edits. */
export function stripRenderedHead(text) {
  let t = text.replace(/^\uFEFF/, '');
  t = t.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  t = t.replace(/^<!--[\s\S]*?-->\r?\n(\r?\n)?/, '');
  return normalizeText(t);
}
