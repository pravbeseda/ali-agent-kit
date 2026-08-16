---
name: instructions-global
description: Audit, tidy and sync the user-level ("global") AI-agent instruction files and Claude Code auto memory on this machine — one master file rendered to Claude Code, Codex and GitHub Copilot, Karpathy guidelines block kept current, drift detected. Manual only, use it only when the user explicitly asks to audit, tidy or sync their global agent instructions, or runs /ali-instructions-global.
disable-model-invocation: true
argument-hint: "[--status|--sync-only|--migrate-and-disable]"
---

# instructions-global

Keep one developer's global agent instructions lean, deduplicated and identical
across Claude Code, Codex and GitHub Copilot on this machine. The source of
truth is the master `~/.agent-instructions/global.md`; every surface gets a
rendered copy with a marker; the Karpathy guidelines live in the master as a
managed block; auto memory is curated, never disabled by default.

Sibling: `instructions-project` does the same for one repository. This skill
never writes inside a repository — `scripts/apply.js` refuses paths outside the
home-level agent dirs, VS Code user settings, Claude auto-memory dirs and the
`~/.agent-instructions` store.

Talk to the user in the language of the conversation; everything written to
files is English (non-English lines are translated during REWORD).

## Modes

Take the mode from the arguments or from natural language ("run in status
mode", "just sync"). Default when nothing is said: full run.

| Mode | Does | Writes |
|---|---|---|
| default | inventory → proposal → approval → apply → verify → report | after approval only |
| `--status` | inventory, drift, Karpathy state, duplicate hints; no proposal, no `report.js` | only the run dir under `~/.agent-instructions/runs/` (`inventory.json`) |
| `--sync-only` | re-render the master to every target (after the user hand-edited the master) | after approval only |
| `--migrate-and-disable` | like default, plus: migrate everything usable out of auto memory, archive the rest, turn auto memory off (`autoMemoryEnabled: false` in `~/.claude/settings.json`) | after approval only |

Config: `~/.agent-instructions/config.json` (`references/config-schema.md`).
Scripts live in `scripts/` next to this file; run them with `node`; every one
takes `--help` and `--json`. Exit codes: 0 ok, 1 usage, 2 refused before any
write, 3 stopped part-way (rollback offered).

## Step 1 — Inventory (read-only)

```sh
node scripts/inventory.js --new-run
```

Prints the surface table (detected?, file, bytes, lines, ~tokens as chars/4,
marker, symlink), VS Code settings with effective values (explicit / default by
version / unknown), memory dirs (slug → path, exists on disk?), the Karpathy
state against the bundled snapshot, env overrides, and warnings: Codex
`AGENTS.override.md` shadowing, the legacy `~/.copilot/copilot-instructions.md`,
`COPILOT_CUSTOM_INSTRUCTIONS_DIRS`, karpathy-guidelines installed as a skill,
VS Code profile instruction files, symlinks, BOMs, size thresholds, shared-file
drift between the two skills. Keep the run id it prints; every later script
takes `--run <id>` and writes only under `~/.agent-instructions/runs/<id>/`.

Then, still read-only:

```sh
node scripts/karpathy.js status            # fetches upstream (6 s timeout, fine in every mode; --offline when there is no network), else snapshot — says which
node scripts/drift.js --diff               # on a first run every target is "never-applied": expected, not a problem
node scripts/dupes.js <the master and every existing target file, plus the legacy files the inventory warns about>
```

`dupes.js` returns exact and near duplicates and secret-looking lines — report
the location of a secret, never echo the value. Contradictions between lines
are yours to spot while reading; no script finds them.

Show the inventory table to the user. In `--status` mode: add the drift and
Karpathy state and the duplicate hints, print the diagnostics checklist as the
*target* state ("what each surface should show once the run is applied"), and
stop — no proposal, no `report.js`.

Re-run semantics: `drift.js` classifies each target — `unchanged`,
`master-moved` (re-render), `hand-edited` (offer: merge the edit into the
master, or overwrite), `both`, `missing`, `never-applied`. If nothing at all
changed since the last run, say "no changes", make no backup, end.

## Step 2 — Proposal (writes only into the run dir)

Source text: the master if it exists; on the first run the union of every
detected target file **plus the legacy channels the inventory warns about**
(`~/.copilot/copilot-instructions.md`, VS Code profile `*.instructions.md`) —
a rule that lives only there must not be lost. Read `references/rubric.md`
before labelling — the label set is closed and each label needs its evidence.
Everything you write by hand goes into `runs/<id>/input/` (the v-next,
rewritten memory files, `parked.md`); `render.js` writes its output under
`runs/<id>/proposal/`.

1. **Label every rule line** of the source (`dupes.js` output is a hint, not a
   verdict; headings and blank lines are structure and get no label). Record
   the labels in `runs/<id>/labels.json` (schema at the end of the rubric) —
   `report.js` counts from that file, so nothing is invented. Never drop a
   "self-evident" line on your own: DEFAULT candidates go into a FLAG batch and
   **stay in the v-next until the user answers**. Prohibitions are never
   softened; concrete values are carried verbatim; contradictions become FLAGs
   with both lines; a project-specific line with no project on this machine
   goes to `parked.md` (`--parked` below).
2. **Harvest auto memory.** For every memory dir from the inventory read the
   topic files: cross-project preferences → MOVE to the master (keep the
   frontmatter of the memory file, remove the moved lines from its body);
   project-specific notes are only counted per project ("project X: N notes →
   run instructions-project there"); machine-specific facts stay. Superseded
   memory files are archived, never deleted (`--archive` below); a memory
   file that loses lines is rewritten with its frontmatter kept
   (`--memory-edits` below).
3. **Karpathy block.** `karpathy.js status` says: `absent` → insert as the last
   section; `current` → nothing; `upstream-ahead` → show its diff, propose the
   update (never silently; `karpathy.pin` disables the proposal);
   `local-edit` → FLAG "keep the local edit (default; mark as local) or restore
   upstream"; `both` → FLAG with both diffs. Lines outside the markers that
   restate a guideline → `DROP:KARPATHY` with the section; stricter user rules →
   the "Local additions" subsection right after the block, phrased as deltas.
   Never edit inside the markers. If a karpathy skill is installed in any agent,
   warn: the block and the skill double each other — the user picks one.
4. **Write the master v-next** to `runs/<id>/input/global.md`, laid out per the
   section template (Communication, Workflow, Code, Environment & tools, Safety,
   Karpathy guidelines + Local additions; an existing sane structure is kept).
   One rule per line, imperative, English. Order of operations for the block:
   write the v-next without it, run
   `node scripts/karpathy.js put --master runs/<id>/input/global.noblock.md --out runs/<id>/input/global.md`,
   then append `### Local additions` (an H3 under the block's H2, so the block
   stays the last section) with the deltas. `karpathy.js status --master <v-next>`
   must say `current` afterwards.
5. **Render** to every detected target and build the plan:

   ```sh
   node scripts/render.js --run <id> --master-from runs/<id>/input/global.md \
     --vscode \
     --archive <legacy copilot file>,<VS Code profile *.instructions.md>,<superseded memory files> \
     [--parked runs/<id>/input/parked.md] [--memory-edits runs/<id>/input/memory-edits.json]
   ```

   `render.js` writes `proposal/*`, `diff/*.diff` and `plan.json` — the whole
   plan; there is no need to hand-edit `plan.json`. It renders only detected,
   enabled surfaces and lists the skipped ones with the reason. `--vscode`
   proposes `chat.useClaudeMdFile: false` and
   `chat.instructionsFilesLocations["~/.copilot/instructions"] = true` for
   every user `settings.json` found (`--vscode-settings <paths>` to pick when
   there are several installs or profiles — ask which, or all). `--archive`
   (absolute paths) moves legacy channels and retired memory files into
   `~/.agent-instructions/archive/<id>/` (never pruned). `--parked` is the
   new full text of `parked.md`; `--memory-edits` maps memory files to their
   rewritten versions. Codex `AGENTS.override.md` present → ask where to write
   before rendering. Symlink at a target → say so; `apply.js` needs
   `--replace-symlinks`.
6. **Show the proposal**: the file table from `render.js`, label counts, the
   FLAG batches as questions (they block the next step), REWORDs as before →
   after, the Karpathy state, threshold warnings (`master_lines`, Codex budget)
   — warnings and questions, never automatic cutting. Diff inline when ≤ 80
   lines, else per-section summary plus the `diff/` path (on a first run the
   Karpathy block alone exceeds that, so summarise: "your rules: 20 → 7 lines;
   Karpathy block: +66 lines"). Decisions the user must make go one at a time,
   with options and a recommendation.

Iterate with the user until the proposal is what they want (re-run `render.js`
after every change to the v-next).

## Step 3 — Approval

Ask exactly one question with the explicit list of files from `plan.json`:
"Apply to these N files? [list]". Subsets are fine (`apply.js --only <paths>`).
Nothing outside `~/.agent-instructions/` is written before a yes. If the user
declines the VS Code edits, print the manual instructions instead (which keys,
which values, which file).

## Step 4 — Apply

```sh
node scripts/apply.js --run <id> [--only <paths>] [--replace-symlinks]
```

Order: master → targets → VS Code settings → moves. Per file: backup into
`~/.agent-instructions/backups/<id>/` → temp write → verify (hash; JSONC still
parses; frontmatter valid) → atomic rename → manifest entry. Any failure stops
the run (exit 3): report what was applied, offer the rollback command — run it
only if the user decides so. Retention keeps the last 10 runs; the size is
printed. `--migrate-and-disable`: after apply, propose the settings edit
`autoMemoryEnabled: false` in `~/.claude/settings.json` as its own approval.

## Step 5 — Verify

`apply.js` re-reads every file and records hashes in `state.json`; then:

```sh
node scripts/drift.js --check  # exit 0 = no changes
node scripts/report.js --run <id> --write
```

Print `references/diagnostics-checklist.md` — the user confirms each surface
sees the text exactly once (Copilot CLI `/instructions`, VS Code Chat
Diagnostics, Claude `/memory`, Codex by asking it).

## Step 6 — Report

Short in chat, full in `runs/<id>/report.md` — layout in
`references/report-template.md`; tables come from `report.js`. Include the
backup line with the restore command, the sync status per surface (written /
skipped because …), and the reminder that VS Code Settings Sync of "Prompts and
Instructions" stays off on purpose.

## Rollback

`node scripts/restore.js --list`, `--run <id>`, `--run <id> --path <file>`;
works without the model, undoes the run from the manifest, last entry first.

## References

- `references/rubric.md` — labels, evidence, calibration examples, labels.json
- `references/surfaces.md` — which surface reads which file, verified dates
- `references/vscode-defaults.md` — settings defaults by version, wanted values
- `references/diagnostics-checklist.md` — per-surface "seen once" checks
- `references/report-template.md`, `references/config-schema.md`
- `references/karpathy-guidelines.md` — offline snapshot of the block source
