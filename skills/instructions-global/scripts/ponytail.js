#!/usr/bin/env node
// instructions-global: the optional Ponytail rules block. Reports its state for
// this machine's config, records the machine's choice (enable / disable / skip a
// rule) in config.json, and writes a new master text with the block inserted,
// updated or removed (to a file of your choice — never to the master itself).

import { existsSync } from 'node:fs';
import { run, isMain, UsageError } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { loadConfig } from './lib/config.js';
import { atomicWrite, readJson, readText, writeJson, ensureDir } from './lib/fsx.js';
import { unifiedDiff } from './lib/diff.js';
import { contentHash, putBlock, removeBlock, KARPATHY, PONYTAIL } from './lib/markers.js';
import { fetchUpstream } from './lib/karpathy.js';
import { readRules, renderBody, classify } from './lib/ponytail.js';

const HELP = `usage: node ponytail.js <command> [options]

commands
  status                      the block's state in the master for this machine's config;
                              also checks whether upstream moved past the curated ref
  put --master <in> --out <out>
                              write <in> with the block inserted or updated (enabled) or removed (disabled)
  enable | disable            record this machine's choice in config.json (ponytail.enabled)
  skip <id> | unskip <id>     turn one rule off or back on for this machine (ponytail.skip)

options
  --master <path>   master file to inspect (default ~/.agent-instructions/global.md)
  --skip <ids>      status / put: the rules to skip in this run instead of ponytail.skip
                    (comma-separated; --skip= for none); config.json is not touched
  --offline         do not check upstream
  --timeout <ms>    upstream check timeout (default 6000)
  --json`;

const PROPOSALS = {
  undecided: 'ask the user once: turn the Ponytail rules on for this machine? Record the answer with `ponytail.js enable` or `disable`',
  off: null,
  remove: 'ponytail.enabled=false: remove the block from the master',
  absent: 'insert the block before the Karpathy section (or last when there is none)',
  current: null,
  stale: 'the curated rules, their ref or ponytail.skip changed: update the block',
  'local-edit': 'FLAG: block edited by hand — move the edit into the user\'s own rules (outside the markers) or drop it, then update the block',
  broken: 'begin marker without end marker — repair by hand before continuing'
};

function updateConfig(change) {
  const { root, config: path } = storePaths();
  const user = readJson(path, {});
  user.ponytail = change({ skip: [], ...user.ponytail });
  ensureDir(root);
  writeJson(path, user);
  return { written: path, ponytail: user.ponytail };
}

async function upstreamCheck(curated, { offline, timeout }) {
  if (offline) return { checked: false, note: 'offline: upstream not checked' };
  try {
    const up = await fetchUpstream(curated.source, { timeoutMs: Number(timeout) || 6000 });
    if (!/^[0-9a-f]{40}$/.test(up.ref)) return { checked: false, note: 'upstream reachable, but its commit could not be read' };
    const ahead = up.ref !== curated.ref;
    return {
      checked: true,
      ref: up.ref,
      ahead,
      note: ahead ? `upstream moved past the curated ref (${curated.ref.slice(0, 7)} → ${up.ref.slice(0, 7)}): a kit maintainer re-curates references/ponytail-rules.md; nothing changes on this machine` : null
    };
  } catch (error) {
    return { checked: false, note: `upstream unreachable (${error.message})` };
  }
}

async function main(flags, positional) {
  const [command, id] = positional;
  if (!command) throw new UsageError('missing command');
  const curated = readRules();
  const ids = curated.rules.map((r) => r.id);

  if (command === 'enable' || command === 'disable') return updateConfig((p) => ({ ...p, enabled: command === 'enable' }));
  if (command === 'skip' || command === 'unskip') {
    if (!ids.includes(id)) throw new UsageError(`unknown rule id ${id ?? '(none)'}; ids: ${ids.join(', ')}`);
    return updateConfig((p) => ({ ...p, skip: command === 'skip' ? [...new Set([...p.skip, id])] : p.skip.filter((s) => s !== id) }));
  }

  const { config } = loadConfig();
  const { enabled } = config.ponytail;
  const unknown = (flags.skip ?? []).filter((s) => !ids.includes(s));
  if (unknown.length) throw new UsageError(`unknown rule id ${unknown.join(', ')}; ids: ${ids.join(', ')}`);
  const skip = flags.skip ?? config.ponytail.skip;
  const masterPath = flags.master ?? storePaths().master;
  const masterText = existsSync(masterPath) ? readText(masterPath).text : '';
  const rendered = renderBody(curated, { skip });
  const { state, block } = classify(masterText, rendered, enabled, curated.ref);
  const result = {
    master: masterPath,
    masterExists: existsSync(masterPath),
    enabled,
    skip,
    unknownSkip: skip.filter((s) => !ids.includes(s)),
    curated: { source: curated.source, ref: curated.ref, curated: curated.curated },
    rules: curated.rules.map((r) => ({ ...r, skipped: skip.includes(r.id) })),
    block: block && !block.broken ? { ref: block.header.ref, hash: block.header.hash, bodyHash: block.bodyHash } : null,
    state,
    proposal: PROPOSALS[state]
  };

  if (command === 'status') {
    const upstream = await upstreamCheck(curated, flags);
    return { ...result, upstream, notes: [upstream.note].filter(Boolean) };
  }

  if (command === 'put') {
    if (!flags.out) throw new UsageError('put needs --out');
    if (state === 'undecided') throw new UsageError('ponytail.enabled is not set for this machine — ask the user, then run `ponytail.js enable` or `disable`');
    if (state === 'broken') throw new UsageError('the block has a begin marker without an end marker — repair it by hand first');
    const next = enabled
      ? putBlock(masterText, PONYTAIL, { source: curated.source, ref: curated.ref, hash: contentHash(rendered), body: rendered }, { before: KARPATHY })
      : removeBlock(masterText, PONYTAIL);
    atomicWrite(flags.out, next);
    return { ...result, written: flags.out, diff: unifiedDiff(masterText, next, { from: tildify(masterPath), to: flags.out }) };
  }
  throw new UsageError(`unknown command ${command}`);
}

function render(r) {
  if (r.ponytail) return `written ${tildify(r.written)}: ponytail ${JSON.stringify(r.ponytail)}`;
  const lines = [
    `master: ${tildify(r.master)}${r.masterExists ? '' : ' (absent)'}`,
    `enabled: ${r.enabled}  skip: ${r.skip.length ? r.skip.join(', ') : '-'}`,
    `curated: ref=${r.curated.ref.slice(0, 12)} on ${r.curated.curated}`,
    `block: ${r.block ? `ref=${r.block.ref.slice(0, 12)} hash=${r.block.hash.slice(0, 12)} body=${r.block.bodyHash.slice(0, 12)}` : 'absent'}`,
    `state: ${r.state}`,
    `proposal: ${r.proposal ?? 'none'}`,
    'rules:',
    ...r.rules.map((rule) => `  ${rule.skipped ? '[skipped] ' : ''}${rule.id}: ${rule.text}`)
  ];
  if (r.unknownSkip.length) lines.push(`warning: ponytail.skip names unknown ids: ${r.unknownSkip.join(', ')}`);
  for (const n of r.notes ?? []) lines.push(`note: ${n}`);
  if (r.written) lines.push(`written ${r.written}; the diff is in the --json output`);
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  run({ spec: { master: 'string', out: 'string', skip: 'list', offline: 'bool', timeout: 'string' }, help: HELP, main, render });
}
