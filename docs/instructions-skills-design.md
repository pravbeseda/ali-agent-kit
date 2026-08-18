# Design note: `instructions-global` and `instructions-project`

Written 2026-08-16 against the design brief v2 of the same date. Records what
was verified (with sources), where the implementation deviates from the brief
and why, and what stays open.

## 1. Repository conventions that shaped the layout

| Convention | Effect |
|---|---|
| Skills are `skills/<name>/SKILL.md` + `references/`, `scripts/`, `agents/`; installed under the `ali-` prefix | both skills are directories; the runtime skill names are `ali-instructions-global` / `ali-instructions-project`, the brief's names without prefix |
| Zero runtime dependencies, plain ESM, Node ≥ 18, no build step | scripts are ESM under `scripts/`, use only `node:` modules and the global `fetch` |
| No shared-asset mechanism between skills | shared code and references are **duplicated** byte-for-byte; `scripts/lib/selfcheck.js` compares checksums with the sibling at run time (warning in every inventory), `test/instructions-skills.test.js` fails the build when the copies diverge. `SHARED` in `selfcheck.js` lists them |
| Frontmatter: unknown keys pass through | `disable-model-invocation: true` and `argument-hint` are carried to every agent; Codex ignores them, so `agents/openai.yaml` sets `policy.allow_implicit_invocation: false` |
| `test/language.test.js` forbids Cyrillic in tracked files | the Russian calibration line lives in fixtures/tests as `\u` escapes; generated fixture files may contain it |
| README skills table is tested against `skills/` | two rows added |
| Installer never writes to `~/.agents/skills` | nothing to do; noted that Codex now documents `~/.agents/skills` as the user location and keeps `~/.codex/skills` as deprecated |

## 2. External facts verified (2026-08-16)

Full quotes are in `skills/instructions-global/references/surfaces.md`; the
per-question research reports (Claude Code, Codex, Copilot, VS Code, Karpathy)
were produced during the build and their conclusions are summarised here.

| Fact | Result | Source |
|---|---|---|
| Claude Code global file, `@` imports | `~/.claude/CLAUDE.md`; imports up to 4 hops; `~/.claude/rules/*.md` exists; `CLAUDE_CONFIG_DIR` overrides the dir | https://code.claude.com/docs/en/memory, https://code.claude.com/docs/en/env-vars |
| Claude Code reads `AGENTS.md` natively? | **No** — "Claude Code reads CLAUDE.md, not AGENTS.md"; `@` import recommended → the shim stands; relative paths resolve against the importing file's directory, so the shim in `.claude/` imports `@../AGENTS.md` | https://code.claude.com/docs/en/memory |
| `CLAUDE.md` vs `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules` | equivalent, both read; local file still supported; rules with `paths:` frontmatter | same |
| Auto memory | `~/.claude/projects/<slug>/memory/`, keyed by git repo; `MEMORY.md` first 200 lines / 25 KB; disable via `/memory`, `autoMemoryEnabled: false`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`; slug documented only by example → resolved against the filesystem | same |
| Claude Code skill frontmatter, arguments | `disable-model-invocation`, `argument-hint`, `user-invocable`, … honoured; `/skill --status` → `$ARGUMENTS`; without a placeholder `ARGUMENTS: --status` is appended | https://code.claude.com/docs/en/skills |
| Codex global file, override, budget | `~/.codex/AGENTS.md` (`CODEX_HOME`); `AGENTS.override.md` read instead; `project_doc_max_bytes` = 32 KiB covers **project** docs (global not counted); overflow truncated | https://developers.openai.com/codex/guides/agents-md → learn.chatgpt.com, config reference, openai/codex source |
| Codex `@import`, CLAUDE.md | not documented / not read (only via fallback filenames) | same |
| Codex skills: manual-only, args | no `disable-model-invocation`; `agents/openai.yaml` `policy.allow_implicit_invocation: false`; text after `$skill` is plain user text | https://developers.openai.com/codex/skills (learn.chatgpt.com/docs/build-skills) |
| Codex sandbox network | off by default → the snapshot fallback is required | learn.chatgpt.com/docs/agent-approvals-security |
| Codex "which instruction files are active" | no command; ask the model; `/status`, `/debug-config` | learn.chatgpt.com/docs/developer-commands |
| Copilot CLI user-level files | **both** `~/.copilot/copilot-instructions.md` and `~/.copilot/instructions/**/*.instructions.md`; `COPILOT_HOME`; `COPILOT_CUSTOM_INSTRUCTIONS_DIRS`; `/instructions` lists and toggles | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions, https://docs.github.com/en/copilot/reference/cli-command-reference |
| Copilot CLI repo files, `@` includes, dedupe | AGENTS.md (root/cwd/intermediate/nested), copilot-instructions.md, `.claude/CLAUDE.md`, GEMINI.md; both AGENTS.md and copilot-instructions.md merged; identical copies deduped; `@` in AGENTS/CLAUDE/copilot-instructions only (relative-vs-absolute: pages conflict) | same |
| Copilot CLI skills | `disable-model-invocation`, `argument-hint`, `user-invocable` honoured; argument passing not documented | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills |
| JetBrains Copilot | reads `.github/copilot-instructions.md`, **not** `AGENTS.md`; global file `global-copilot-instructions.md` in `~/.config/github-copilot/intellij/` (macOS) / `%LOCALAPPDATA%\github-copilot\intellij\` (Windows); Linux not listed | https://docs.github.com/en/copilot/reference/custom-instructions-support, …/add-repository-instructions-in-your-ide?tool=jetbrains |
| Claude/Codex partner agents inside Copilot | docs say nothing about injecting `AGENTS.md`/`CLAUDE.md` | https://docs.github.com/en/copilot/concepts/agents/anthropic-claude |
| VS Code `chat.useClaudeMdFile` | exists, default `true`, covers root, `.claude/`, `~/.claude/CLAUDE.md`, `CLAUDE.local.md`; `@` imports not documented; `.claude/rules` via `chat.instructionsFilesLocations` | https://code.visualstudio.com/docs/agent-customization/custom-instructions, https://code.visualstudio.com/docs/agents/reference/ai-settings |
| VS Code Agent Host, Copilot harness | reads `~/.copilot/instructions`, not the profile folder ("legacy location that the Copilot agent doesn't read") | https://code.visualstudio.com/docs/agents/concepts/agent-host |
| VS Code settings defaults by version | `useAgentsMdFile` 1.104 true; `useNestedAgentsMdFiles` 1.105 false; `useClaudeMdFile` 1.109 true; `instructionsFilesLocations` 1.100; `agentHost.enabled` opt-in (default not printed) | release notes; `references/vscode-defaults.md` |
| VS Code diagnostics | Chat view → right-click → Diagnostics; `Chat: Configure Instructions` | same |
| Karpathy source | SKILL.md body ≠ repo `CLAUDE.md` (H1, intro sentence, trailing paragraph differ; sections 1–4 identical) → the SKILL.md body is used; last commit `64723a4` (2026-01-28); no LICENSE file in the repo, MIT declared in frontmatter/README; body sha256 `62b20340…` | https://github.com/multica-ai/andrej-karpathy-skills |

## 3. Deviations from the brief

| Brief | Implementation | Why |
|---|---|---|
| §10 marker `sha256=<body hash>` of the upstream body | the marker hash is the hash of the **rendered block body** (upstream body with headings demoted one level + one attribution line, LF, single trailing newline) | lets `karpathy.js` detect hand edits inside the markers offline, from the master alone; the upstream body hash is still printed by `status` |
| §10 "H1 demoted to the master's section level", body verbatim | every heading is demoted one level (H1→H2, H2→H3) so the four sections nest under the master's H2; text otherwise verbatim | keeps the master's outline consistent; the alternative (only H1 demoted) leaves the sections at the master's own level |
| §4/§11 Copilot user-level channel "VERIFY which" | Copilot CLI reads both locations → `~/.copilot/instructions/global.instructions.md` is the channel; `~/.copilot/copilot-instructions.md` is treated as legacy and archived after approval | one channel per surface (decision 9); the instructions folder is also what the Agent Host harness and the classic extension (via `chat.instructionsFilesLocations`) read |
| §5 "retiring legacy files" | legacy files and superseded memory files are **moved** into `~/.agent-instructions/archive/<run-id>/` (never pruned), not removed | backups are pruned after 10 runs; an archive keeps the retire reversible for good |
| §6 root `CLAUDE.md` "replaced by the shim" | archived the same way (working tree shows the deletion; git history keeps it) | same reasoning; the user commits |
| §12 shared assets | duplication + checksum self-check + repo test (the brief's fallback) | the repo has no shared-asset mechanism and adding one means changing the installer, which the brief forbids |
| §12 script runtime | Node.js ESM (repo convention) | — |
| §7 near-duplicate threshold | Dice ≥ 0.7 over token sets (stop words removed, trailing punctuation stripped) as the default hint threshold | 0.8 missed "Never push to main." vs "Never push to main without asking." — the calibration pair |
| §5 detection of "VS Code Agent Host on/off" | detected and reported only; the wanted settings do not branch on it | as the brief requires |
| §12 test loop | scripts covered by `test/instructions-skills.test.js` (19 tests, fake HOMEs and repos from `test/fixtures/instructions/make-fixtures.js`); model-driven runs on the fixtures done with subagents (with-skill only — a "no skill" baseline cannot run a manual workflow with bundled scripts, so it was not measured) | — |
| (added after the brief, at the user's request) | after apply, `review.js` builds a before/after/diff bundle and a second reader with a clean context (at least Opus-class) reviews it; the user then accepts or rolls back (`references/review-prompt.md`) | the tidying pass and its reviewer must not share a context; the decision to keep the result stays with the user |
| Acceptance run | `inventory.js`, `karpathy.js status`, `drift.js`, `dupes.js` were run on the developer's own machine with `AGENT_INSTRUCTIONS_DIR` pointed at a scratch dir, so no file under `~` was created; results in the summary of the PR | "proposal mode, no writes" taken literally |

## 4. Open questions

1. **Copilot CLI doubling of the shim.** The CLI reads `.claude/CLAUDE.md`, expands `@../AGENTS.md`, and dedupes only *identical copies*; the shim carries a marker, so the canon may be counted twice. Not testable without a Copilot CLI session on a repo. Listed in the diagnostics checklist; if confirmed, options are a symlink (not portable to Windows) or a shim without marker (drift then needs the state file the brief rules out for repos).
2. **Claude partner agent inside Copilot** — whether GitHub injects `AGENTS.md`/`.claude/CLAUDE.md` into it. Not documented.
3. **JetBrains on Linux** — the global file path is documented for macOS and Windows only; `~/.config/github-copilot/intellij/` is assumed.
4. **Copilot CLI argument passing** to skills — not documented; the SKILL.md bodies accept the options in natural language.
5. **VS Code `chat.instructionsFilesLocations` default** — the settings reference and the custom-instructions page disagree; the skill sets `~/.copilot/instructions` explicitly, so the default does not matter for the wanted state.
6. **`~/.codex/skills` deprecation** in the Codex source: the kit still installs there. Out of scope for these skills; worth an issue on the installer if Codex stops reading it.

## 5. Scenario coverage (§12)

Automated (`npm test`): bloated global file with duplicates, filler, project
lines, secret; memory dirs with mixed content; Karpathy absent/current/
upstream-ahead/local-edit/both, offline fallback; `AGENTS.override.md` present
(symlinked); `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` set; VS Code stable + Insiders
with `useClaudeMdFile` absent/true, Agent Host on/off; symlink at a target; an
agent not installed (JetBrains); second run idempotent; hand-edited target and
edited master → drift; restore; project: solo repo with root `CLAUDE.md`,
`AGENTS.md` + `CLAUDE.md` disagreeing, team repo → stop, team with
`--shared-ok`, `copilot-instructions.md` with content (archive and
`--copilot-copy`), nested `AGENTS.md` and `.claude/rules` inventory-only,
`AGENTS.override.md` in the repo, global never run → warning, memory promotion
with frontmatter kept, `.vscode/settings.json` override, directory without git.

By hand / by the model: the label pass itself (rubric), the report narrative,
the approval dialogue. Four subagent runs against the fixtures were done during
the build (global `--status`, global full run to the approval question,
project full run on `repo-solo`, project `--status` on `repo-mixed` and
`repo-team`): no script errors; the labels matched the calibration examples;
their notes produced this round of changes — `--status` explicit and read-only
also for shared repos, `runs/<id>/input/` for the model's own files,
`render.js --parked/--memory-edits` so `plan.json` is never hand-edited,
headings unlabelled, relative paths in global files → FLAG not STALE, FLAG
lines stay in the v-next, `drift.js --check`, unified-diff hunk header for new
files, the shim proposal no longer a dotfile. A second round (global full run,
project full run on `repo-mixed` with `--copilot-copy`) needed no hand edits of
`plan.json` and produced the expected labels; it added the FLAG batch names,
the in-text FLAG marker, the delta label and the memory-index rules to the
rubric. `test/fixtures/instructions/scenarios.md`
lists the scenarios and their expected outcomes for the next hand run.
