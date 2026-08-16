# Surfaces × levels × files

Everything in this file was checked against the official docs on
**2026-08-16**. Paths, setting names and reader behaviour move; when a script
warns "unknown" or a checklist step fails, re-verify against the source column
and update the date here. `scripts/lib/surfaces.js` and `scripts/lib/paths.js`
encode the "we write" column.

Legend: ✔ reads · ✘ does not read · ? not stated in the docs (NOT VERIFIED).

## Global (user) level

| Surface | Reads at user level | We write (channel) | Reads AGENTS.md | Reads CLAUDE.md | `@` imports | Source | Verified |
|---|---|---|---|---|---|---|---|
| Claude Code (CLI, IDE, desktop, web) | `~/.claude/CLAUDE.md` (`CLAUDE_CONFIG_DIR` overrides the dir); `~/.claude/rules/*.md`; auto memory `~/.claude/projects/<slug>/memory/` | `~/.claude/CLAUDE.md` — rendered copy | ✘ ("Claude Code reads CLAUDE.md, not AGENTS.md") | ✔ | ✔ `@path`, max depth 4, skipped inside code spans/fences | https://code.claude.com/docs/en/memory, https://code.claude.com/docs/en/env-vars | 2026-08-16 |
| Codex CLI / IDE extension / desktop app | `~/.codex/AGENTS.md`; `AGENTS.override.md` in the same dir is read *instead* (first non-empty file); `CODEX_HOME` overrides the dir | `~/.codex/AGENTS.md` | ✔ | ✘ (only via `project_doc_fallback_filenames`, project level) | ✘ not documented | https://developers.openai.com/codex/guides/agents-md (redirects to learn.chatgpt.com/docs/agent-configuration/agents-md), https://developers.openai.com/codex/config-reference | 2026-08-16 |
| Codex cloud | nothing at user level | — | ✔ repo only | ✘ | ✘ | same | 2026-08-16 |
| Copilot CLI | `~/.copilot/copilot-instructions.md` **and** `~/.copilot/instructions/**/*.instructions.md` (both; `COPILOT_HOME` overrides the dir; `--config-dir` deprecated); `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` adds dirs searched for `AGENTS.md` and `*.instructions.md` | `~/.copilot/instructions/global.instructions.md` (frontmatter `applyTo: "**"`); `~/.copilot/copilot-instructions.md` is the legacy channel → archived after approval | ✔ (repo) | ✔ `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md` (repo) | ✔ in `copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, recursive; not in `*.instructions.md`; how-to says repo-relative only, reference page allows absolute — pages conflict | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions, https://docs.github.com/en/copilot/reference/cli-command-reference | 2026-08-16 |
| VS Code, Copilot Chat extension ("Local" harness) | profile `User/prompts/*.instructions.md` and folders in `chat.instructionsFilesLocations` (object path → bool, `~` allowed; `~/.copilot/instructions` appears in the official example); `~/.claude/CLAUDE.md` when `chat.useClaudeMdFile` is `true` (default `true`); `.claude/rules` via `instructionsFilesLocations` | nothing in the profile; `chat.useClaudeMdFile: false`; `chat.instructionsFilesLocations["~/.copilot/instructions"] = true` | ✔ root `AGENTS.md` (`chat.useAgentsMdFile`, default `true`; nested off by default) | ✔ when the setting is on | ? not documented (treat as not expanded) | https://code.visualstudio.com/docs/agent-customization/custom-instructions, https://code.visualstudio.com/docs/agents/reference/ai-settings | 2026-08-16 |
| VS Code Agent Host — Copilot harness | `~/.copilot/instructions` (docs: the profile folder is a "legacy location that the Copilot agent doesn't read") | same file as Copilot CLI | ✔ | ? | ? | https://code.visualstudio.com/docs/agents/concepts/agent-host | 2026-08-16 |
| VS Code Agent Host — Claude harness | Claude Code's own files (`~/.claude`) | via Claude Code's file | ✘ | ✔ | ✔ | same | 2026-08-16 (inferred: docs name `~/.claude`, not the file) |
| VS Code Agent Host — Codex harness | ? (experimental; assumed Codex's own files) | via Codex's file | ✔ | ✘ | ✘ | same | NOT VERIFIED |
| Copilot in JetBrains / Android Studio | `global-copilot-instructions.md` in `~/.config/github-copilot/intellij/` (macOS), `%LOCALAPPDATA%\github-copilot\intellij\` (Windows); Linux path not listed — assumed like macOS | that file | ✘ (Chat: personal, repository-wide `.github/copilot-instructions.md`, path-specific only) → `--copilot-copy` | ✘ | ✘ | https://docs.github.com/en/copilot/reference/custom-instructions-support, https://docs.github.com/en/copilot/how-tos/configure-custom-instructions-in-your-ide/add-repository-instructions-in-your-ide?tool=jetbrains | 2026-08-16 |
| Copilot coding agent; Claude / Codex partner agents inside Copilot | nothing at user level | — | ✔ `AGENTS.md` anywhere (nearest wins), `.github/copilot-instructions.md`, `.github/instructions/**`, single root `CLAUDE.md`/`GEMINI.md` | ✔ root | ? | https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions, https://docs.github.com/en/copilot/concepts/agents/anthropic-claude | 2026-08-16; whether the Claude partner agent *also* receives `AGENTS.md`/the shim is NOT documented |

## Project level

| Agent | Files (precedence / discovery) | Notes |
|---|---|---|
| Claude Code | `CLAUDE.md` or `.claude/CLAUDE.md` (equivalent, both read if both exist), `CLAUDE.local.md` (appended, gitignore it), `.claude/rules/*.md` (`paths:` frontmatter, recursive), parent-dir CLAUDE.md files up the tree, subdir CLAUDE.md on demand | canon = `AGENTS.md`; shim `.claude/CLAUDE.md` = marker + `@AGENTS.md` (+ Claude-only content). Root `CLAUDE.md` migrated into `AGENTS.md`, archived |
| Codex | per directory `AGENTS.override.md` > `AGENTS.md` > `project_doc_fallback_filenames`; git root → cwd, one file per dir, concatenated root-first; `project_doc_max_bytes` = 32 KiB combined project docs (the global file is not counted; overflow truncated with a tracing warning) | canon read natively; nested files inventory-only |
| Copilot CLI | `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md` (`applyTo`), `AGENTS.md` (root, cwd, intermediate dirs, nested for worked-on paths), `CLAUDE.md`, `.claude/CLAUDE.md`, `GEMINI.md`; both `AGENTS.md` and `copilot-instructions.md` are read and merged; identical copies deduped | shim's `@AGENTS.md` expands → possible doubling (diagnostics checklist) |
| Copilot in VS Code | root `AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/**`, `CLAUDE.md` files when `chat.useClaudeMdFile` (we turn it off), `.claude/rules` via locations, `.vscode/settings.json` can override the keys | |
| Copilot coding agent / cloud | as above; nearest `AGENTS.md` wins | repository files must be self-sufficient |
| Copilot in JetBrains | `.github/copilot-instructions.md` only (path-specific documented inconsistently) | `--copilot-copy` renders it from `AGENTS.md` |

## Skills: what each host reads from frontmatter (for the manual-only requirement)

| Host | Personal skills dir | Fields honoured | Prevent auto-invocation | Arguments |
|---|---|---|---|---|
| Claude Code | `~/.claude/skills/<name>/SKILL.md` | `name`, `description`, `disable-model-invocation`, `argument-hint`, `allowed-tools`, `user-invocable`, `context`, `model`, … | `disable-model-invocation: true` | `$ARGUMENTS`, `$0`/`$1`; without a placeholder `ARGUMENTS: …` is appended to the body |
| Codex | `~/.codex/skills/` (kept, deprecated in source), `~/.agents/skills/`, `.agents/skills/` | `name`, `description` (+ `model`, `metadata.short-description`) — no `disable-model-invocation` | `agents/openai.yaml` → `policy.allow_implicit_invocation: false` | none: the user's text after `$skill-name` arrives as plain user text |
| Copilot CLI | `~/.copilot/skills/`, `.github/skills/`, `.agents/skills/`, `.claude/skills/`, `COPILOT_SKILLS_DIRS` | `name`, `description`, `argument-hint`, `allowed-tools`, `user-invocable`, `disable-model-invocation`, `license` | `disable-model-invocation: true` | invoked as `/skill-name`; how trailing text reaches the body is NOT documented → the body accepts options in natural language |

Sources: https://code.claude.com/docs/en/skills, https://developers.openai.com/codex/skills (learn.chatgpt.com/docs/build-skills) + openai/codex source (`codex-rs/skills`), https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills — 2026-08-16.

## Auto memory (Claude Code)

`~/.claude/projects/<slug>/memory/` — keyed by git repository (worktrees and
subdirs share one dir); `MEMORY.md` index (first 200 lines / 25 KB loaded per
session), topic files with frontmatter; slug documented only by example
(`/home/user/work/my-repo` → `-home-user-work-my-repo`, so `memory.js`
resolves it against the filesystem). Disable: `/memory` toggle,
`autoMemoryEnabled: false` in settings, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`;
relocate with `autoMemoryDirectory`. Source: https://code.claude.com/docs/en/memory — 2026-08-16.

## Detection

`~/.claude` (`CLAUDE_CONFIG_DIR`), `~/.codex` (`CODEX_HOME`), `~/.copilot`
(`COPILOT_HOME`), binaries `claude` / `codex` / `copilot` / `code` on PATH, VS
Code user dirs (`Code`, `Code - Insiders`, `VSCodium`, `User/profiles/*`,
`~/.vscode-server/data/User`), the JetBrains Copilot dir. Undetected → skipped
and reported; detected without file → created after approval. Windows: `~` =
`%USERPROFILE%`.
