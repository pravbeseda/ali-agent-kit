// Shared between ali-instructions-global and ali-instructions-project.
// The write protocol: backup → temp write → verify → atomic rename → manifest,
// file by file, stopping at the first failure. Also restore and retention.
//
// A plan is JSON: { runId, skill, actions: [
//   { action: 'write',    path, from }               // create or overwrite `path` with the file `from`
//   { action: 'move',     path, to }
//   { action: 'remove',   path }
//   { action: 'settings', path, set: { key: value } } // JSONC point edits; value null removes the key
// ] }
// Every path must fall under one of `allow` roots — the caller (each skill's own
// apply.js) decides those, which is what keeps the two skills to their scopes.

import { existsSync, lstatSync, statSync, readFileSync, renameSync, unlinkSync, rmSync, readdirSync, readlinkSync, symlinkSync, realpathSync } from 'node:fs';
import { dirname, basename, resolve, sep, join } from 'node:path';
import { atomicWrite, copyPreserving, ensureDir, sha256, readText, readJson, writeJson, walkFiles } from './fsx.js';
import { parseJsonc, setTopLevelKey } from './jsonc.js';
import { mirrorPath, storePaths } from './paths.js';
import { EXIT } from './cli.js';

export class ApplyError extends Error {
  constructor(message, data) {
    super(message);
    this.data = data;
    this.exitCode = EXIT.PARTIAL;
  }
}

/**
 * Real path of `p`: the deepest existing ancestor is resolved through symlinks
 * (realpath), the missing tail is appended lexically. So a symlinked directory
 * on the way cannot smuggle a write outside the allowed roots.
 */
function realish(p) {
  let base = resolve(p);
  const tail = [];
  while (!existsSync(base)) {
    const parent = dirname(base);
    if (parent === base) return resolve(p);
    tail.unshift(basename(base));
    base = parent;
  }
  return join(realpathSync(base), ...tail);
}

function under(path, root) {
  const p = realish(path);
  const r = realish(root);
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** lstat without following the link; null when nothing is there at all. */
function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

/**
 * State of `path` before/after an action. A symlink (dangling or not) is
 * recorded as such, with its link target, so a rollback can recreate the link
 * instead of materialising whatever it pointed to.
 */
function snapshot(path) {
  const lst = lstatOrNull(path);
  if (!lst) return null;
  if (lst.isSymbolicLink()) {
    const target = readlinkSync(path);
    const st = existsSync(path) ? statSync(path) : null;
    return { symlink: target, dangling: !st, sha256: st ? sha256(readFileSync(path)) : null, size: st?.size ?? 0 };
  }
  if (lst.isDirectory()) return { directory: true };
  return { sha256: sha256(readFileSync(path)), size: lst.size };
}

/** Frontmatter, when present, must be a fenced list of `key: value` lines. */
function verifyFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m) {
    if (/^---\r?\n/.test(text)) throw new Error('frontmatter opened but never closed');
    return;
  }
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (!/^[A-Za-z0-9_-]+\s*:/.test(line) && !/^\s+\S/.test(line) && !/^\s*-\s/.test(line)) {
      throw new Error(`frontmatter line is not YAML key: value — ${line}`);
    }
  }
}

/**
 * applyPlan(plan, { allow, deny, replaceSymlinks, dryRun, env })
 * → manifest (also written to backups/<runId>/manifest.json unless dryRun).
 * Throws ApplyError with the partial manifest attached on the first failure.
 */
export function applyPlan(plan, { allow, deny = [], replaceSymlinks = false, dryRun = false, env = process.env }) {
  const store = storePaths(env);
  const backupRoot = join(store.backups, plan.runId);
  const manifest = {
    runId: plan.runId,
    skill: plan.skill,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    status: dryRun ? 'dry-run' : 'running',
    backupDir: backupRoot,
    entries: []
  };

  // Validate everything before touching anything.
  for (const action of plan.actions) {
    for (const p of [action.path, action.to].filter(Boolean)) {
      if (!allow.some((root) => under(p, root))) {
        throw new ApplyError(`refusing ${p}: outside the allowed roots (${allow.join(', ')})`, { manifest });
      }
      if (deny.some((root) => under(p, root))) {
        throw new ApplyError(`refusing ${p}: inside a denied root`, { manifest });
      }
    }
    if (action.action === 'write' && !existsSync(action.from)) {
      throw new ApplyError(`missing source ${action.from} for ${action.path}`, { manifest });
    }
    // lstat, not existsSync: a dangling symlink is still a symlink the user set up
    if (lstatOrNull(action.path)?.isSymbolicLink() && !replaceSymlinks) {
      throw new ApplyError(`${action.path} is a symlink; rerun with --replace-symlinks to replace it`, { manifest });
    }
  }

  const persist = () => {
    if (dryRun) return;
    ensureDir(backupRoot);
    writeJson(join(backupRoot, 'manifest.json'), manifest);
  };

  for (const action of plan.actions) {
    const entry = { path: action.path, action: action.action, before: snapshot(action.path), after: null, backup: null };
    try {
      if (!dryRun && entry.before && !entry.before.directory) {
        entry.backup = mirrorPath(backupRoot, action.path);
        // A symlink is backed up as a link (its target is not ours to copy or restore).
        if (entry.before.symlink) {
          ensureDir(dirname(entry.backup));
          symlinkSync(entry.before.symlink, entry.backup);
        } else copyPreserving(action.path, entry.backup);
      }
      switch (action.action) {
        case 'write': {
          entry.action = entry.before ? 'overwrite' : 'create';
          const content = readFileSync(action.from);
          const text = content.toString('utf8');
          if (/\.md$/i.test(action.path)) verifyFrontmatter(text);
          if (!dryRun) {
            // rename over a symlink replaces the link itself (the target file is left alone)
            atomicWrite(action.path, content, { mode: action.mode ?? (entry.before?.symlink ? 0o644 : undefined) });
          }
          entry.after = dryRun ? { sha256: sha256(content), size: content.length } : snapshot(action.path);
          if (!dryRun && entry.after.sha256 !== sha256(content)) throw new Error('hash mismatch after write');
          break;
        }
        case 'settings': {
          const current = existsSync(action.path) ? readText(action.path).text : '';
          let next = current;
          for (const [key, value] of Object.entries(action.set)) {
            next = setTopLevelKey(next, key, value === null ? undefined : value);
          }
          parseJsonc(next); // must still parse
          if (!dryRun) atomicWrite(action.path, next);
          entry.after = dryRun ? { sha256: sha256(next), size: Buffer.byteLength(next) } : snapshot(action.path);
          break;
        }
        case 'move': {
          if (!entry.before) throw new Error('nothing to move');
          entry.to = action.to;
          if (existsSync(action.to)) throw new Error(`destination exists: ${action.to}`);
          if (!dryRun) {
            ensureDir(dirname(action.to));
            renameSync(action.path, action.to);
          }
          entry.after = dryRun ? entry.before : snapshot(action.to);
          break;
        }
        case 'remove': {
          if (!entry.before) throw new Error('nothing to remove');
          if (!dryRun) unlinkSync(action.path);
          entry.after = null;
          break;
        }
        default:
          throw new Error(`unknown action ${action.action}`);
      }
      manifest.entries.push(entry);
      persist();
    } catch (error) {
      manifest.entries.push({ ...entry, failed: error.message });
      manifest.status = 'partial';
      manifest.finishedAt = new Date().toISOString();
      manifest.error = `${action.action} ${action.path}: ${error.message}`;
      persist();
      throw new ApplyError(manifest.error, { manifest });
    }
  }
  manifest.status = dryRun ? 'dry-run' : 'complete';
  manifest.finishedAt = new Date().toISOString();
  persist();
  return manifest;
}

/** Undo a run from its manifest, last entry first. Returns the list of restored paths. */
export function restoreRun(manifest, { only, dryRun = false } = {}) {
  const done = [];
  for (const entry of [...manifest.entries].reverse()) {
    if (entry.failed) continue;
    if (only && resolve(entry.path) !== resolve(only) && resolve(entry.to ?? '') !== resolve(only)) continue;
    const step = { path: entry.path, action: entry.action };
    if (!dryRun) {
      switch (entry.action) {
        case 'create':
          if (lstatOrNull(entry.path)) unlinkSync(entry.path);
          break;
        case 'overwrite':
        case 'settings':
        case 'remove':
          if (entry.before?.symlink) {
            // put the link back, not the content it pointed to
            if (lstatOrNull(entry.path)) unlinkSync(entry.path);
            ensureDir(dirname(entry.path));
            symlinkSync(entry.before.symlink, entry.path);
          } else if (entry.backup) copyPreserving(entry.backup, entry.path);
          else if (lstatOrNull(entry.path)) unlinkSync(entry.path); // created by this run, nothing to bring back
          break;
        case 'move':
          if (existsSync(entry.to)) {
            ensureDir(dirname(entry.path));
            if (existsSync(entry.path)) unlinkSync(entry.path);
            renameSync(entry.to, entry.path);
          } else if (entry.backup) {
            copyPreserving(entry.backup, entry.path);
          }
          break;
        default:
          continue;
      }
    }
    done.push(step);
  }
  return done;
}

/** Keep the newest `keep` backup runs; return what was pruned and the size that remains. */
export function pruneBackups(keep, env = process.env) {
  const root = storePaths(env).backups;
  if (!existsSync(root)) return { pruned: [], kept: [], totalBytes: 0 };
  const runs = readdirSync(root)
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort();
  const pruned = runs.slice(0, Math.max(0, runs.length - keep));
  for (const name of pruned) rmSync(join(root, name), { recursive: true, force: true });
  const kept = runs.slice(pruned.length);
  let totalBytes = 0;
  for (const name of kept) for (const file of walkFiles(join(root, name))) totalBytes += statSync(file).size;
  return { pruned, kept, totalBytes };
}

export function listRuns(env = process.env) {
  const root = storePaths(env).backups;
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => existsSync(join(root, name, 'manifest.json')))
    .sort()
    .map((name) => {
      const manifest = readJson(join(root, name, 'manifest.json'));
      return {
        runId: name,
        skill: manifest.skill,
        status: manifest.status,
        startedAt: manifest.startedAt,
        files: manifest.entries.length,
        manifest: join(root, name, 'manifest.json')
      };
    });
}
