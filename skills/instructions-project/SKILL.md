---
name: instructions-project
description: Audit and tidy the AI-agent instruction files of the current git repository — canonical AGENTS.md, Claude Code shim .claude/CLAUDE.md, optional Copilot copy — and promote stable auto-memory notes into it; refuses team repositories unless authorized for the run. Manual only, use it only when the user explicitly asks to audit, tidy or sync a repository's agent instructions, or runs /ali-instructions-project.
disable-model-invocation: true
argument-hint: "[--status|--sync-only|--shared-ok|--assume-global|--copilot-copy]"
---

# instructions-project

Make one repository's agent instructions self-sufficient, deduplicated and
readable by every agent: the canon is `AGENTS.md` at the root; Claude Code
reads it through the shim `.claude/CLAUDE.md` (`@AGENTS.md`); Copilot family
readers get either `AGENTS.md` itself or, with `--copilot-copy`, a generated
`.github/copilot-instructions.md`. Repository files never rely on the user's
global files — cloud agents and teammates do not have them.

Sibling: `instructions-global` owns the home-level files. This skill reads
them (to know what the global already says) and never writes them —
`scripts/apply.js` refuses paths outside the repository, this project's Claude
auto-memory dir and the `~/.agent-instructions` store. It never commits; only
the working tree changes.

Talk to the user in the language of the conversation; everything written to
files is English.

## Modes and flags

From the arguments or natural language ("status mode", "this is a team repo,
go ahead" = `--shared-ok`).

| Flag | Meaning |
|---|---|
| default | gate → inventory → proposal → approval → apply → verify → report |
| `--status` | gate (advisory: a shared verdict is reported, not enforced) + inventory + drift; no proposal; writes only the run dir under `~/.agent-instructions/runs/` |
| `--sync-only` | re-render the shim (and the Copilot copy) from the current `AGENTS.md` |
| `--shared-ok` | authorization to edit a shared/team repository — this run only |
| `--assume-global` | the repo runs only on this machine: lines duplicated in the global master may be dropped |
| `--copilot-copy` | keep `.github/copilot-instructions.md` as a generated copy (JetBrains does not read `AGENTS.md`); default from `config.copilot_copy` |

Scripts live in `scripts/`; `node scripts/<name>.js --help`; `--json` on all.

## Step 1 — Gate

```sh
node scripts/gate.js [--shared-ok] [--status] [--plain-dir]
```

Not a git repository → stop (exit 2). Only if the user insists, `--plain-dir`
treats the directory as the project root without classification. Otherwise the
gate classifies the repository from evidence — other commit authors (bots and
the user's own emails/logins from config excluded), CODEOWNERS, remote owner
vs `config.git_logins`, CONTRIBUTING as a hint — and prints the evidence with
the verdict ("you" = `git config user.email` plus `config.git_emails` /
`git_logins`). `shared` without `--shared-ok` → stop and tell the user how to
authorize — except in `--status`, which is read-only: pass `--status` to the
gate, report the verdict, and continue with the inventory. With `--shared-ok`,
edit the shared files directly, but every purely personal line (communication
style, personal tool preferences) is a FLAG for the user: it does not belong in
a team file.

## Step 2 — Inventory (read-only)

```sh
node scripts/inventory.js --new-run
node scripts/drift.js --diff
node scripts/dupes.js <every root instruction file the inventory found> ~/.agent-instructions/global.md   # those that exist
```

`dupes.js` finds exact and near duplicates and secret-looking lines (report
those, never echo the value); contradictions between files are yours to spot
while reading — no script finds them. If the global master is absent, do not
audit the raw global files from here: say "run instructions-global first" and
go on with the repository alone.

The inventory lists the root files (`AGENTS.md`, `AGENTS.override.md`,
`CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`,
`.github/copilot-instructions.md`, `GEMINI.md`) with metrics, the nested and
path-scoped files (`.claude/rules/*.md`, `.github/instructions/*.instructions.md`,
nested `AGENTS.md`/`CLAUDE.md`) — **inventory only, never edited**, the shim
state (`absent`, `in-sync`, `drift`, `not-a-shim`, `orphan`), the Copilot copy
state, `.vscode/settings.json` overrides of the chat keys, this project's
auto-memory dir, the global master and the last global run (never ran → warn:
deduplicating against an unaudited global is meaningless; continue), and the
Codex chain size (global + project) against the budget. `AGENTS.override.md`
at the root shadows `AGENTS.md` for Codex — warn and ask before touching either.

`--status`: show the gate verdict, the inventory table, the shim/copy state,
the nested-files inventory, the drift table (`absent` is a state, not drift),
the `dupes.js` summary and the warnings — then stop. `drift.js` says "drift
detected" only for `agents-moved` / `hand-edited` / `both`.

## Step 3 — Proposal (writes only into `~/.agent-instructions/runs/<id>/`)

Read `references/rubric.md` first. Then:

1. **Canonical `AGENTS.md`** = merge of the existing `AGENTS.md`, root
   `CLAUDE.md`, `.claude/CLAUDE.md` (if hand-written) and
   `.github/copilot-instructions.md`, cleaned line by line with the rubric
   (headings and blank lines are structure, not rules — they get no label).
   Sections: About · Commands · Conventions · Architecture notes · Safety (an
   existing sane structure is kept). Write it to `runs/<id>/input/AGENTS.md`
   (your input; `render.js` writes its output under `proposal/`) and record
   every label in `runs/<id>/labels.json`.
   - Duplicates of the global master are **kept** by default (compress the
     wording, remove duplication inside the project file); only with
     `--assume-global` may they become `DROP:DUP` naming the master line.
   - A project line that contradicts a global line is an override, not a
     conflict: it stays.
   - Claude-specific content (Claude tools, hooks, skills, `/commands`) is not
     for `AGENTS.md`: it goes into the shim after `@AGENTS.md`.
   - `AGENTS.override.md` lines are labelled FLAG (batch `OVERRIDE`): keep the
     override, merge it into `AGENTS.md`, or archive it (`render.js --archive
     <absolute path>` works for repository files too). Never silently.
   - `.vscode/settings.json` with `chat.useClaudeMdFile: true` is advice only
     ("VS Code will read the shim and `AGENTS.md` both here"); the skill does not
     edit workspace settings.
2. **Memory promotion.** From this project's memory dir: stable project facts
   (commands, conventions, architecture) → `AGENTS.md`; machine-specific facts
   (absolute paths, local versions, ports) never enter a git-tracked file — they
   stay in memory or are archived. After promotion the moved lines are removed
   from the memory file (frontmatter kept), `MEMORY.md` is kept ≤ 200 lines,
   superseded files are archived (never deleted). Write the rewritten memory
   files into `runs/<id>/input/` and pass them with `--memory-edits`.
3. **Render and plan:**

   ```sh
   node scripts/render.js --run <id> --agents-from runs/<id>/input/AGENTS.md \
     [--claude-only runs/<id>/input/claude-only.md] [--copilot-copy] [--memory-edits <json>] [--archive <memory files>]
   ```

   Produces `proposal/*`, `diff/*`, `plan.json`: write `AGENTS.md`; write the
   shim (`<!-- instructions-project: shim; canonical AGENTS.md sha256 … -->`,
   `@AGENTS.md`, optional Claude-only content); archive the root `CLAUDE.md`
   (merged) into `~/.agent-instructions/archive/<id>/`; archive
   `.github/copilot-instructions.md` (merged) unless `--copilot-copy` renders it
   or `--keep-copilot` leaves a hand-written one alone; `CLAUDE.local.md` only
   when the user asked for a personal-only place (`--claude-local <file>`).
4. **Show the proposal**: the file table, label counts, FLAG batches as
   questions (block the next step), REWORDs before → after, threshold warnings
   (`project_lines`, Codex chain) — `node scripts/report.js --run <id>` prints
   the tables from `labels.json` and `plan.json`. Diff inline when ≤ 80 lines, else per-section
   summary plus the `diff/` path. Iterate until the user is happy.

## Step 4 — Approval

One question, the explicit list of files from `plan.json`: "Apply to these N
files? [list]". Subsets allowed (`--only`). No file in the repository or the
memory dir is written before a yes.

## Step 5 — Apply, verify, report

```sh
node scripts/apply.js --run <id> [--only <paths>] [--replace-symlinks]
node scripts/drift.js --check    # exit 0 = shim (and copy) in-sync
node scripts/report.js --run <id> --write
```

Apply: backup → temp write → verify → atomic rename → manifest, per file, in
plan order; first failure stops (exit 3), what was applied is listed, rollback
(`node scripts/restore.js --run <id>`) is offered and run only on the user's
decision. Drift for a repository is read from the marker hashes only — no state
file lives in the repo. Report: short in chat, full in `runs/<id>/report.md`
(`references/report-template.md`; tables from `report.js`), including "git
status" of the changed paths — the user commits, this skill does not.

`--sync-only`: skip the proposal; `render.js --run <id>` with the current
`AGENTS.md`, approve, apply.

## References

- `references/rubric.md` — labels, evidence, calibration, labels.json
- `references/surfaces.md` — project-level readers per agent (Copilot CLI may
  count the shim's `@AGENTS.md` a second time — see the diagnostics note there)
- `references/report-template.md`, `references/config-schema.md`
