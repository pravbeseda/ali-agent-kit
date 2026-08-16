// Shared between ali-instructions-global and ali-instructions-project.
// Minimal argv parsing and uniform output. Every script: `--help`, `--json`,
// exit 0 ok / 1 usage / 2 error / 3 partial apply (see apply.js).

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXIT = { OK: 0, USAGE: 1, ERROR: 2, PARTIAL: 3 };

/**
 * parseArgs(argv, spec) → { flags, positional }
 * spec: { name: 'bool' | 'string' | 'list' } — unknown flags are an error.
 */
export function parseArgs(argv, spec) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    let [name, inline] = arg.slice(2).split(/=(.*)/s);
    const kind = spec[name];
    if (!kind) throw new UsageError(`unknown option --${name}`);
    if (kind === 'bool') {
      flags[name] = inline === undefined ? true : inline !== 'false';
      continue;
    }
    const value = inline !== undefined ? inline : argv[++i];
    if (value === undefined) throw new UsageError(`--${name} needs a value`);
    if (kind === 'list') (flags[name] ??= []).push(...value.split(',').filter(Boolean));
    else flags[name] = value;
  }
  return { flags, positional };
}

export class UsageError extends Error {}

/** Run `main(flags, positional)`; print result as JSON or via `render`; map errors to exit codes. */
export async function run({ argv = process.argv.slice(2), spec, help, main, render }) {
  const fullSpec = { help: 'bool', json: 'bool', ...spec };
  let parsed;
  try {
    parsed = parseArgs(argv, fullSpec);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${help}\n`);
    process.exit(EXIT.USAGE);
  }
  if (parsed.flags.help) {
    process.stdout.write(help.trimEnd() + '\n');
    return process.exit(EXIT.OK);
  }
  try {
    const result = await main(parsed.flags, parsed.positional);
    const exitCode = result?.exitCode ?? EXIT.OK;
    if (parsed.flags.json || !render) process.stdout.write(JSON.stringify(result ?? {}, null, 2) + '\n');
    else process.stdout.write(render(result).trimEnd() + '\n');
    process.exit(exitCode);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${help}\n`);
      process.exit(EXIT.USAGE);
    }
    if (parsed.flags.json) {
      process.stdout.write(JSON.stringify({ error: error.message, ...(error.data ?? {}) }, null, 2) + '\n');
    } else {
      process.stderr.write(`error: ${error.message}\n`);
    }
    process.exit(error.exitCode ?? EXIT.ERROR);
  }
}

/** Markdown table from rows of plain values; `columns` = [[key, header], ...]. */
export function table(columns, rows) {
  const head = `| ${columns.map(([, h]) => h).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map(([k]) => cell(row[k])).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

function cell(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function fmtBytes(n) {
  if (n === undefined || n === null) return '';
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KiB`;
}

export function fmtDelta(before, after) {
  if (!before) return after ? 'new' : '';
  const pct = ((after - before) / before) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
}

/** True when the module at `metaUrl` is the script Node was started with. */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
}
