# Report template

Two reports per run. Numbers in both come from `report.js` (tables) — the
model writes the narrative around them and never types a byte count or a line
count by hand.

## Short report (in chat)

```
**Outcome.** One paragraph: what was proposed / applied, in how many files,
what still needs the user (FLAG batches), whether anything failed.

| file | before → after | delta |      ← the "Files" table from report.js
| label | count |                       ← the "Labels" table

**FLAG — please answer** (these block the next step)
1. batch DEFAULT: <n> lines proposed to drop as default behaviour — approve all / pick / keep all?
2. <file>:<line> "<text>" vs <file>:<line> "<text>" — conflict; which one?
...

**Sync status**                          ← from the "Sync status per surface" table
Claude Code: ~/.claude/CLAUDE.md written · Codex: written · Copilot CLI: created ·
JetBrains: skipped (plugin dir missing) · VS Code: settings edited (chat.useClaudeMdFile=false)

**Backup:** ~/.agent-instructions/backups/<run-id> — restore with `node scripts/restore.js --run <run-id>`
Full report: ~/.agent-instructions/runs/<run-id>/report.md
```

Diff shown inline when the whole diff is ≤ 80 lines; otherwise a per-section
summary ("Communication: 3 lines merged into 1; Code: 2 lines moved to
foo-service") plus the path of `runs/<run-id>/diff/` — any part on request.

## Full report (`runs/<run-id>/report.md`)

Sections, in order — paste the `report.js` tables where they belong:

1. **Outcome** — the same paragraph as the chat, plus the run id, the mode
   (`default` / `--status` / `--sync-only` / …), the skill version.
2. **Files** — table before → after (bytes, lines, ~tokens chars/4, delta %),
   compared with the inventory of this run and with the previous run when
   `state.json` has one.
3. **Labels** — counts, then every label with its reason:
   REWORD as before → after; MERGE with the surviving line; MOVE as from → to;
   DROP grouped by code with evidence; FLAG grouped by batch with the question.
4. **Karpathy block** — state (absent / current / upstream-ahead / local-edit /
   both), ref before → after, the diff when an update was proposed, doubling
   warnings (installed as a skill).
5. **Sync status per surface** — channel, written / skipped and why, legacy
   channels retired.
6. **VS Code** — every settings.json found, effective values of the six keys
   (explicit / default by version / unknown), the edits made or the manual
   instructions when the user declined.
7. **Path-scoped and nested files** — inventory only: `.claude/rules/*.md`,
   `.github/instructions/*.instructions.md`, nested `AGENTS.md`/`CLAUDE.md`,
   `AGENTS.override.md`.
8. **Threshold warnings** — master / project lines, Codex chain bytes.
9. **Diagnostics checklist** — from `references/diagnostics-checklist.md`, one
   line per surface, for the user to tick.
10. **Reminders** — VS Code Settings Sync of "Prompts and Instructions" is
    intentionally off (this skill runs per machine); memory files archived.
11. **Backup** — dir, size, retention, restore command; previous run id.
