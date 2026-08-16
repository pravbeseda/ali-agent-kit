// Shared between ali-instructions-global and ali-instructions-project.
// The Karpathy guidelines block: fetch upstream (short timeout), fall back to
// the bundled snapshot, render the block body, and classify the state of the
// block found in a master file.

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentHash, findKarpathyBlock } from './markers.js';

const SNAPSHOT_RE = /<!--\s*snapshot: source=(\S+) ref=(\S+) fetched=(\S+)\s*-->/;

export function snapshotPath(referencesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'references')) {
  return join(referencesDir, 'karpathy-guidelines.md');
}

/** Strip YAML frontmatter from a SKILL.md and normalise. */
export function bodyOfSkillMd(text) {
  const t = text.replace(/^\uFEFF/, '');
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(t);
  return (m ? t.slice(m[0].length) : t).replace(/\r\n?/g, '\n').replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

/**
 * Block body as it goes into the master: upstream body with every heading
 * demoted one level (H1 → H2, the master's section level; H2 → H3), plus one
 * attribution line. Content is otherwise verbatim.
 */
export function renderBlockBody(upstreamBody, { source, license = 'MIT' }) {
  const demoted = upstreamBody
    .split('\n')
    .map((line) => (/^#{1,5}\s/.test(line) ? '#' + line : line))
    .join('\n')
    .replace(/\s+$/, '');
  return `${demoted}\n\n_Source: ${source} (${license}). Managed block: edit outside the markers._`;
}

/** Bundled snapshot: { body, source, ref, fetched } or null. */
export function readSnapshot(path = snapshotPath()) {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const m = SNAPSHOT_RE.exec(text);
  const body = text.slice(m ? m.index + m[0].length : 0).replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
  return { body, source: m?.[1] ?? null, ref: m?.[2] ?? null, fetched: m?.[3] ?? null, path };
}

/** Text of a snapshot file for a given upstream body. */
export function formatSnapshot({ body, source, ref, fetched }) {
  return `<!-- snapshot: source=${source} ref=${ref} fetched=${fetched} -->\n${body.replace(/\s+$/, '')}\n`;
}

/**
 * fetchUpstream(source, { timeoutMs }) → { body, ref, sha, fetchedAt } — throws on any failure.
 * `ref` is the commit sha of the file when the GitHub API answers, else the fetch date.
 */
export async function fetchUpstream(source, { timeoutMs = 6000, fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) throw new Error('fetch is not available in this Node');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(source, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    const body = bodyOfSkillMd(raw);
    const fetchedAt = new Date().toISOString().slice(0, 10);
    let ref = fetchedAt;
    const gh = /raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/refs\/heads\/([^/]+)\/(.+)$/.exec(source);
    if (gh) {
      try {
        const api = `https://api.github.com/repos/${gh[1]}/${gh[2]}/commits?sha=${gh[3]}&path=${gh[4]}&per_page=1`;
        const r = await fetchImpl(api, { signal: controller.signal, headers: { accept: 'application/vnd.github+json' } });
        if (r.ok) {
          const [commit] = await r.json();
          if (commit?.sha) ref = commit.sha;
        }
      } catch {
        /* keep the date */
      }
    }
    return { body, ref, fetchedAt, bodyHash: contentHash(body) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Where does the block in `masterText` stand relative to `upstreamBlockBody`
 * (already rendered with renderBlockBody)?
 *   absent | current | upstream-ahead | local-edit | both | broken | disabled
 */
export function classify(masterText, upstreamRendered) {
  const found = findKarpathyBlock(masterText ?? '');
  if (!found) return { state: 'absent' };
  if (found.broken) return { state: 'broken', start: found.start };
  const upstreamHash = contentHash(upstreamRendered);
  const localEdit = found.bodyHash !== found.header.hash;
  const upstreamMoved = upstreamHash !== found.header.hash;
  let state = 'current';
  if (localEdit && upstreamMoved) state = 'both';
  else if (localEdit) state = 'local-edit';
  else if (upstreamMoved) state = 'upstream-ahead';
  return { state, header: found.header, bodyHash: found.bodyHash, upstreamHash, block: found };
}

/** Section headings inside the block, for DROP:KARPATHY references ("§2 Simplicity First"). */
export function sectionsOf(blockBody) {
  return blockBody
    .split('\n')
    .map((l) => /^#{2,4}\s+(\d+)\.\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ number: Number(m[1]), title: m[2].trim() }));
}
