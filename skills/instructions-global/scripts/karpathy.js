#!/usr/bin/env node
// instructions-global: the Karpathy guidelines block. Fetches upstream with a
// short timeout, falls back to the bundled snapshot, classifies the block in
// the master, renders the block, and writes a new master text with the block
// inserted or updated (to a file of your choice — never to the master itself).

import { existsSync } from 'node:fs';
import { run, isMain, UsageError } from './lib/cli.js';
import { storePaths, tildify } from './lib/paths.js';
import { loadConfig } from './lib/config.js';
import { atomicWrite, readText } from './lib/fsx.js';
import { unifiedDiff } from './lib/diff.js';
import { contentHash, putKarpathyBlock } from './lib/markers.js';
import { fetchUpstream, readSnapshot, renderBlockBody, classify, sectionsOf, formatSnapshot, snapshotPath } from './lib/karpathy.js';

const HELP = `usage: node karpathy.js <command> [options]

commands
  status                      fetch upstream (or snapshot), compare with the block in the master
  render --out <file>         write the rendered block body (what goes between the markers)
  put --master <in> --out <out>
                              write <in> with the block inserted or replaced by the current upstream/snapshot
  update-snapshot             refresh references/karpathy-guidelines.md from upstream (maintainer)

options
  --master <path>   master file to inspect (default ~/.agent-instructions/global.md)
  --offline         do not fetch; use the bundled snapshot
  --timeout <ms>    fetch timeout (default 6000)
  --json`;

async function upstreamOrSnapshot(config, { offline, timeout }) {
  const source = config.karpathy.source;
  const snapshot = readSnapshot();
  const notes = [];
  let body = null;
  let ref = null;
  let origin = null;
  if (config.karpathy.pin) notes.push(`karpathy.pin=${config.karpathy.pin}: update proposals are disabled`);
  if (!offline) {
    try {
      const up = await fetchUpstream(source, { timeoutMs: Number(timeout) || 6000 });
      body = up.body;
      ref = up.ref;
      origin = 'upstream';
    } catch (error) {
      notes.push(`upstream unreachable (${error.message}), using snapshot ${snapshot?.ref ?? '(none)'}`);
    }
  } else {
    notes.push(`offline: using snapshot ${snapshot?.ref ?? '(none)'}`);
  }
  if (!body) {
    if (!snapshot) throw new Error('no upstream and no bundled snapshot — cannot continue');
    body = snapshot.body;
    ref = snapshot.ref ?? snapshot.fetched ?? 'snapshot';
    origin = 'snapshot';
  }
  const rendered = renderBlockBody(body, { source });
  return { source, body, ref, origin, rendered, hash: contentHash(rendered), notes, snapshot };
}

async function main(flags, positional) {
  const command = positional[0];
  if (!command) throw new UsageError('missing command');
  const { config } = loadConfig();
  const masterPath = flags.master ?? storePaths().master;
  const masterText = existsSync(masterPath) ? readText(masterPath).text : '';

  if (command === 'update-snapshot') {
    const up = await fetchUpstream(config.karpathy.source, { timeoutMs: Number(flags.timeout) || 6000 });
    const path = snapshotPath();
    atomicWrite(path, formatSnapshot({ body: up.body, source: config.karpathy.source, ref: up.ref, fetched: up.fetchedAt }));
    return { written: path, ref: up.ref, bodyHash: up.bodyHash };
  }

  const up = await upstreamOrSnapshot(config, flags);
  if (!config.karpathy.enabled) up.notes.push('karpathy.enabled=false in config: only reporting');

  if (command === 'render') {
    if (!flags.out) throw new UsageError('render needs --out');
    atomicWrite(flags.out, up.rendered + '\n');
    return { written: flags.out, ref: up.ref, origin: up.origin, hash: up.hash, notes: up.notes };
  }

  const state = classify(masterText, up.rendered);
  const result = {
    master: masterPath,
    masterExists: existsSync(masterPath),
    enabled: config.karpathy.enabled,
    pin: config.karpathy.pin,
    upstream: { source: up.source, ref: up.ref, origin: up.origin, hash: up.hash },
    block: state.header ? { ref: state.header.ref, hash: state.header.hash, bodyHash: state.bodyHash } : null,
    state: state.state,
    sections: sectionsOf(up.rendered),
    notes: up.notes,
    proposal: null,
    diff: null
  };
  if (state.state === 'absent') result.proposal = 'insert the block as the last section of the master';
  else if (state.state === 'upstream-ahead') {
    result.proposal = config.karpathy.pin ? 'upstream moved but karpathy.pin is set — no update' : 'upstream moved — show the diff and propose an update';
    result.diff = unifiedDiff(state.block.body + '\n', up.rendered + '\n', { from: `block ref=${state.header.ref}`, to: `upstream ref=${up.ref}` });
  } else if (state.state === 'local-edit') result.proposal = 'FLAG: block edited by hand — keep local edit (default, mark as local) or restore upstream';
  else if (state.state === 'both') result.proposal = 'FLAG: block edited by hand AND upstream moved — show both diffs, ask';
  else if (state.state === 'broken') result.proposal = 'begin marker without end marker — repair by hand before continuing';
  if (!config.karpathy.enabled && ['absent', 'upstream-ahead'].includes(state.state)) {
    result.proposal = `none — karpathy.enabled=false in config (block ${state.state}); the state is reported, nothing is inserted or updated`;
  }

  if (command === 'status') return result;

  if (command === 'put') {
    if (!flags.out) throw new UsageError('put needs --out');
    if (!config.karpathy.enabled) throw new UsageError('karpathy.enabled is false in config — put refuses to insert or update the block (set it to true first)');
    const next = putKarpathyBlock(masterText, { source: up.source, ref: up.ref, hash: up.hash, body: up.rendered });
    atomicWrite(flags.out, next);
    return { ...result, written: flags.out, diff: unifiedDiff(masterText, next, { from: tildify(masterPath), to: flags.out }) };
  }
  throw new UsageError(`unknown command ${command}`);
}

function render(r) {
  if (r.written && !r.state) return `written ${r.written} (ref ${r.ref}, ${r.origin ?? 'upstream'})`;
  const lines = [
    `master: ${tildify(r.master)}${r.masterExists ? '' : ' (absent)'}`,
    `upstream: ${r.upstream.origin} ref=${r.upstream.ref} hash=${r.upstream.hash.slice(0, 12)}`,
    `block: ${r.block ? `ref=${r.block.ref} hash=${r.block.hash.slice(0, 12)} body=${r.block.bodyHash.slice(0, 12)}` : 'absent'}`,
    `state: ${r.state}`,
    `proposal: ${r.proposal ?? 'none — current'}`
  ];
  for (const n of r.notes) lines.push(`note: ${n}`);
  if (r.written) lines.push(`written ${r.written} (block ${r.state === 'absent' ? 'inserted' : 'replaced'}; the diff is in the --json output)`);
  else if (r.diff) lines.push('', r.diff);
  return lines.join('\n');
}

if (isMain(import.meta.url)) {
  run({ spec: { master: 'string', out: 'string', offline: 'bool', timeout: 'string' }, help: HELP, main, render });
}
