// Shared between ali-instructions-global and ali-instructions-project.
// Detect which agents are on this machine and where each one reads its
// user-level instructions. See references/surfaces.md for the sources.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { platform } from 'node:os';
import { agentDirs, jetbrainsCopilotDir, vscodeUserDirs } from './paths.js';
import { fileInfo, readText, walkFiles } from './fsx.js';
import { parseGeneratedMarker } from './markers.js';

export function onPath(binary, env = process.env) {
  const exts = platform() === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, binary + ext);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/**
 * detectSurfaces(env) → [{ id, label, detected, configDir, target, channel, extra }]
 * `target` is the one file we render to for that surface; `extra` lists other
 * files the surface reads at the same level (legacy channels, overrides).
 */
export function detectSurfaces(env = process.env, { disabled = [] } = {}) {
  const dirs = agentDirs(env);
  const jb = jetbrainsCopilotDir(env);
  const out = [];

  out.push({
    id: 'claude',
    label: 'Claude Code',
    detected: existsSync(dirs.claude),
    configDir: dirs.claude,
    target: join(dirs.claude, 'CLAUDE.md'),
    channel: '~/.claude/CLAUDE.md (rendered copy; @imports would also work but are not used)',
    binary: onPath('claude', env),
    extra: {
      rules: walkFiles(join(dirs.claude, 'rules')).filter((f) => f.endsWith('.md'))
    }
  });

  out.push({
    id: 'codex',
    label: 'Codex CLI / IDE / app',
    detected: existsSync(dirs.codex),
    configDir: dirs.codex,
    target: join(dirs.codex, 'AGENTS.md'),
    channel: '~/.codex/AGENTS.md',
    binary: onPath('codex', env),
    extra: {
      override: existsSync(join(dirs.codex, 'AGENTS.override.md')) ? join(dirs.codex, 'AGENTS.override.md') : null
    }
  });

  const copilotInstructions = join(dirs.copilot, 'instructions');
  out.push({
    id: 'copilot-cli',
    label: 'GitHub Copilot CLI (+ VS Code Agent Host Copilot harness)',
    detected: existsSync(dirs.copilot),
    configDir: dirs.copilot,
    target: join(copilotInstructions, 'global.instructions.md'),
    channel: '~/.copilot/instructions/global.instructions.md',
    binary: onPath('copilot', env),
    extra: {
      legacy: existsSync(join(dirs.copilot, 'copilot-instructions.md')) ? join(dirs.copilot, 'copilot-instructions.md') : null,
      otherInstructionFiles: walkFiles(copilotInstructions).filter(
        (f) => f.endsWith('.instructions.md') && f !== join(copilotInstructions, 'global.instructions.md')
      ),
      customInstructionsDirs: (env.COPILOT_CUSTOM_INSTRUCTIONS_DIRS || '').split(',').map((s) => s.trim()).filter(Boolean)
    }
  });

  out.push({
    id: 'jetbrains',
    label: 'GitHub Copilot in JetBrains / Android Studio',
    detected: existsSync(jb),
    configDir: jb,
    target: join(jb, 'global-copilot-instructions.md'),
    channel: 'global-copilot-instructions.md in the plugin dir',
    binary: null,
    extra: {}
  });

  const vscode = vscodeUserDirs(env);
  out.push({
    id: 'vscode',
    label: 'VS Code (Copilot Chat extension) — configuration only, no file rendered',
    detected: vscode.length > 0,
    configDir: vscode.map((v) => v.dir).join(', ') || null,
    target: null,
    channel: 'reads ~/.copilot/instructions via chat.instructionsFilesLocations; chat.useClaudeMdFile off',
    binary: onPath('code', env) || onPath('code-insiders', env),
    extra: {
      profileInstructionFiles: vscode.flatMap((v) =>
        walkFiles(join(v.dir, 'prompts')).filter((f) => f.endsWith('.instructions.md'))
      )
    }
  });

  for (const s of out) {
    s.disabled = disabled.includes(s.id);
    s.file = s.target ? fileInfo(s.target) : null;
    s.marker = s.file?.exists && !s.file.directory ? parseGeneratedMarker(readText(s.target).text) : null;
  }
  return out;
}

/** Skill dirs where a karpathy-guidelines skill would double the master's block. */
export function findKarpathySkills(env = process.env) {
  const dirs = agentDirs(env);
  const roots = [join(dirs.claude, 'skills'), join(dirs.codex, 'skills'), join(dirs.copilot, 'skills'), join(dirs.agents, 'skills')];
  const hits = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (/karpathy/i.test(name)) hits.push(join(root, name));
    }
  }
  return hits;
}
