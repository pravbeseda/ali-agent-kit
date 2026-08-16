// Shared between ali-instructions-global and ali-instructions-project.
// Path resolution: home, the ~/.agent-instructions store, agent config dirs.
// Pure functions of `env` and `home` so tests can point them at a temp dir.

import { homedir, platform } from 'node:os';
import { join, resolve, isAbsolute, sep } from 'node:path';
import { existsSync } from 'node:fs';

export function homeDir(env = process.env) {
  // os.homedir() already honours HOME on POSIX and USERPROFILE on Windows;
  // the explicit fallback keeps a stripped-down env (CI, sandboxes) working.
  return env.HOME || env.USERPROFILE || homedir();
}

/** Expand a leading `~` and normalise separators; absolute paths pass through. */
export function expandHome(p, home = homeDir()) {
  if (!p) return p;
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(home, p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

/** Print a path with `~` for the home dir, so reports read the same on every machine. */
export function tildify(p, home = homeDir()) {
  if (!p) return p;
  if (p === home) return '~';
  if (p.startsWith(home + sep)) return '~' + p.slice(home.length).split(sep).join('/');
  return p;
}

/** Root of everything this pair of skills owns outside the agents' own dirs. */
export function storeDir(env = process.env, home = homeDir(env)) {
  return env.AGENT_INSTRUCTIONS_DIR ? resolve(env.AGENT_INSTRUCTIONS_DIR) : join(home, '.agent-instructions');
}

export function storePaths(env = process.env, home = homeDir(env)) {
  const root = storeDir(env, home);
  return {
    root,
    master: join(root, 'global.md'),
    config: join(root, 'config.json'),
    state: join(root, 'state.json'),
    parked: join(root, 'parked.md'),
    runs: join(root, 'runs'),
    backups: join(root, 'backups')
  };
}

/** Agent config dirs, honouring each agent's documented override. */
export function agentDirs(env = process.env, home = homeDir(env)) {
  return {
    claude: env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(home, '.claude'),
    codex: env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(home, '.codex'),
    // Copilot CLI documents COPILOT_HOME; the kit's own installer also accepts COPILOT_CONFIG_DIR.
    copilot: env.COPILOT_HOME
      ? resolve(env.COPILOT_HOME)
      : env.COPILOT_CONFIG_DIR
        ? resolve(env.COPILOT_CONFIG_DIR)
        : join(home, '.copilot'),
    agents: join(home, '.agents')
  };
}

/**
 * JetBrains Copilot plugin: dir of `global-copilot-instructions.md` (see references/surfaces.md).
 * Documented for macOS (`~/.config/github-copilot/intellij/`) and Windows
 * (`%LOCALAPPDATA%\github-copilot\intellij\`); Linux is assumed to follow macOS.
 */
export function jetbrainsCopilotDir(env = process.env, home = homeDir(env), os = platform()) {
  if (os === 'win32') {
    const base = env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    return join(base, 'github-copilot', 'intellij');
  }
  return join(home, '.config', 'github-copilot', 'intellij');
}

/** Candidate VS Code user dirs (each may hold settings.json and prompts/). */
export function vscodeUserDirs(env = process.env, home = homeDir(env), os = platform()) {
  const roots = [];
  if (os === 'darwin') {
    roots.push(join(home, 'Library', 'Application Support'));
  } else if (os === 'win32') {
    roots.push(env.APPDATA || join(home, 'AppData', 'Roaming'));
  } else {
    roots.push(env.XDG_CONFIG_HOME ? resolve(env.XDG_CONFIG_HOME) : join(home, '.config'));
  }
  const out = [];
  for (const root of roots) {
    for (const flavour of ['Code', 'Code - Insiders', 'VSCodium']) {
      out.push({ flavour, dir: join(root, flavour, 'User') });
    }
  }
  // Remote / WSL server installs keep their own user data.
  out.push({ flavour: 'vscode-server', dir: join(home, '.vscode-server', 'data', 'User') });
  out.push({ flavour: 'vscode-server-insiders', dir: join(home, '.vscode-server-insiders', 'data', 'User') });
  return out.filter((entry) => existsSync(entry.dir));
}

/**
 * Where a backup of `absPath` lives inside a run's backup dir: paths under the
 * home dir mirror as `home/<relative>`, others as their absolute path (a
 * Windows drive letter becomes a segment).
 */
export function mirrorPath(backupRoot, absPath, home = homeDir()) {
  if (absPath.startsWith(home + sep)) return join(backupRoot, 'home', absPath.slice(home.length + 1));
  let rel = absPath;
  const drive = /^([A-Za-z]):[\\/]/.exec(absPath);
  if (drive) rel = drive[1] + sep + absPath.slice(3);
  rel = rel.replace(/^[\\/]+/, '');
  return join(backupRoot, rel);
}
