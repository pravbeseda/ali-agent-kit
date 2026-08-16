# Diagnostics checklist

Printed at the end of a global run. The scripts verify what is on disk; only
the agents themselves can confirm what they *load*. The user ticks each surface
once: "sees the text exactly once".

| Surface | How to check | Expect |
|---|---|---|
| Claude Code | `/memory` in a session (lists loaded memory files) | `~/.claude/CLAUDE.md` once; in a repo also `.claude/CLAUDE.md` → `@AGENTS.md`; no root `CLAUDE.md` after migration |
| Codex CLI | no built-in listing (verified 2026-08-16); run `codex "Show which instruction files are active."` from the repo, or `/status` for the writable roots and `/debug-config` for config layers | `~/.codex/AGENTS.md` (or `AGENTS.override.md` if it exists — warned) + repo `AGENTS.md` chain |
| Copilot CLI | `/instructions` in a session | `~/.copilot/instructions/global.instructions.md` once, no `~/.copilot/copilot-instructions.md`; in a repo `AGENTS.md`; watch for `.claude/CLAUDE.md` being counted a second time (its `@AGENTS.md` expands) — see the note below |
| VS Code (Copilot Chat) | right-click the Chat view → **Diagnostics** after one request; or `Chat: Configure Instructions` | one user-level file from `~/.copilot/instructions`; no `~/.claude/CLAUDE.md` (setting off); root `AGENTS.md`; nothing from the profile `prompts/` folder |
| VS Code Agent Host, Copilot harness | same Diagnostics view with the Agent Host on | same as above — the harness reads `~/.copilot/instructions` |
| VS Code Agent Host, Claude harness | Claude's own `/memory` | Claude Code files, not the Copilot ones |
| JetBrains / Android Studio | Copilot Chat → settings icon → **Customizations** | `global-copilot-instructions.md` once; repo `.github/copilot-instructions.md` only if `--copilot-copy` |
| Copilot coding agent, partner agents (Claude/Codex in Copilot) | a session log on github.com | repo `AGENTS.md`; whether the Claude partner agent also gets `.claude/CLAUDE.md` is not documented — check once and report |

Note on Copilot CLI doubling: the CLI reads `AGENTS.md`, `CLAUDE.md`,
`.claude/CLAUDE.md` and expands `@` includes, and removes only *identical
copies*. The shim is not byte-identical to `AGENTS.md` (it carries a marker),
so the CLI may count the canon twice. If `/instructions` shows both, toggle
`.claude/CLAUDE.md` off for that session and report it as a finding — the
alternative (a symlink) is not portable to the Windows machine.
