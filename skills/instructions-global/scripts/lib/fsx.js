// Shared between ali-instructions-global and ali-instructions-project.
// File primitives: hashing, text inspection, atomic writes, JSON helpers.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  statSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  chmodSync,
  readdirSync
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, basename } from 'node:path';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

/** Rough token estimate: chars / 4. The method is always reported next to the number. */
export const TOKEN_METHOD = 'chars/4';
export function approxTokens(text) {
  return Math.ceil(text.length / 4);
}

/** Read UTF-8 text, report BOM and dominant EOL, return normalised text (no BOM). */
export function readText(path) {
  const buf = readFileSync(path);
  let text = buf.toString('utf8');
  const bom = text.charCodeAt(0) === 0xfeff;
  if (bom) text = text.slice(1);
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(?<!\r)\n/g) || []).length;
  const eol = crlf > lf ? 'CRLF' : crlf > 0 ? 'mixed' : 'LF';
  return { text, bom, eol, bytes: buf.length };
}

export function metricsOf(text, bytes = Buffer.byteLength(text, 'utf8')) {
  const lines = text.length === 0 ? 0 : text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
  return { bytes, lines, tokens: approxTokens(text), tokenMethod: TOKEN_METHOD };
}

export function fileInfo(path) {
  if (!existsSync(path)) return { path, exists: false };
  const lst = lstatSync(path);
  const symlink = lst.isSymbolicLink();
  const st = statSync(path);
  if (st.isDirectory()) return { path, exists: true, directory: true, symlink };
  const { text, bom, eol, bytes } = readText(path);
  return {
    path,
    exists: true,
    symlink,
    bom,
    eol,
    mode: st.mode & 0o777,
    sha256: sha256(readFileSync(path)),
    ...metricsOf(text, bytes)
  };
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

/** Files under a directory, recursively, as absolute paths (no symlink following). */
export function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      const st = lstatSync(full);
      if (st.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}

/**
 * Write atomically: temp file in the same directory, then rename over the target.
 * Preserves the mode of an existing target; new files get 0o644.
 * Returns the sha256 of what landed on disk (re-read after the rename).
 */
export function atomicWrite(path, content, { mode } = {}) {
  ensureDir(dirname(path));
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(4).toString('hex')}.tmp`);
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  const keepMode = mode ?? (existsSync(path) ? statSync(path).mode & 0o777 : 0o644);
  writeFileSync(tmp, data);
  try {
    chmodSync(tmp, keepMode);
  } catch {
    /* Windows: mode bits are advisory */
  }
  const written = sha256(readFileSync(tmp));
  const expected = sha256(data);
  if (written !== expected) {
    unlinkSync(tmp);
    throw new Error(`verify failed after writing ${path}: hash mismatch before rename`);
  }
  renameSync(tmp, path);
  const landed = sha256(readFileSync(path));
  if (landed !== expected) throw new Error(`verify failed after renaming ${path}: hash mismatch`);
  return landed;
}

export function copyPreserving(from, to) {
  ensureDir(dirname(to));
  copyFileSync(from, to);
  try {
    chmodSync(to, statSync(from).mode & 0o777);
  } catch {
    /* ignore */
  }
}

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing ${path}`);
  }
  return JSON.parse(readText(path).text);
}

export function writeJson(path, value) {
  atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
}

/** UTF-8 without BOM, LF, exactly one trailing newline. */
export function normalizeText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '') + '\n';
}
