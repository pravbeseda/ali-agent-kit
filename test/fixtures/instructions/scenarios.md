# Model-driven scenarios for the instructions skills

`npm test` covers the scripts. These scenarios exercise the parts only the
model does — labelling, memory triage, the dialogue — and are run by hand (or
by a subagent) against fixtures built with `make-fixtures.js`:

```sh
node test/fixtures/instructions/make-fixtures.js /tmp/instr-fixtures
HOME=/tmp/instr-fixtures/home-bloated claude   # then: /ali-instructions-global
```

Every command the skill runs must be prefixed with the fake `HOME` (the scripts
honour `HOME` / `USERPROFILE`; `AGENT_INSTRUCTIONS_DIR` relocates the store).

| # | Fixture | Prompt | Expected |
|---|---|---|---|
| G1 | `home-bloated` | `/ali-instructions-global --status` | inventory table; Karpathy `absent`; warnings: legacy `~/.copilot/copilot-instructions.md`, VS Code profile instruction file; memory dir `foo-service` resolved; diagnostics checklist; no proposal, no writes outside `~/.agent-instructions/runs` |
| G2 | `home-bloated` | `/ali-instructions-global` | labels per the calibration examples (rubric §"Calibration"): secret → DROP:SECRET + warning; "Use meaningful variable names" → FLAG batch DEFAULT; "Never push to main" trio → MERGE keeping "never"; foo-service line → MOVE to `~/Workspace/foo-service` (exists) ; `scripts/old-build.sh` → DROP:STALE (path missing); Russian line → REWORD; Karpathy restatement → DROP:KARPATHY §2 and the npm-dependencies delta → Local additions; memory: short-answers → master, tests → "project foo-service: 1 note", python path stays; proposal master ≤ 150 lines with the block last; render to claude/codex/copilot-cli, jetbrains skipped; VS Code edits proposed for stable + Insiders (ask which); legacy Copilot file archived; one approval question listing the files; stops there without a yes |
| G3 | `home-bloated`, second run after G2 applied | `/ali-instructions-global` | "no changes", no backup |
| G4 | after hand-editing `~/.claude/CLAUDE.md` | `/ali-instructions-global` | drift `hand-edited`, offer merge or overwrite |
| G5 | `home-bloated`, network blocked | `/ali-instructions-global --status` | Karpathy from snapshot, says so |
| P1 | `repo-solo` (cwd) + `home-minimal` | `/ali-instructions-project` | gate personal; warning "global never run"; AGENTS.md proposal (Commands: `npm test`; Conventions: npm not pnpm; "clean code" → DROP:VAGUE; `/review` line → Claude-only in the shim); root `CLAUDE.md` archived; approval question; stops |
| P2 | `repo-mixed` | `/ali-instructions-project --status` | nested `packages/api/AGENTS.md`, `.claude/rules/ts.md`, `.github/instructions/docs.instructions.md` inventory-only; `AGENTS.override.md` warning; `.vscode` override `chat.useClaudeMdFile: true`; copilot file hand-written; conflict `Use pnpm` vs `never pnpm` → FLAG (in a default run) |
| P3 | `repo-team` | `/ali-instructions-project` | gate: shared (other author, CODEOWNERS) → stop with the authorization hint; `--shared-ok` proceeds and flags personal lines |
| P4 | `dir-nogit` | `/ali-instructions-project` | refuses; `--plain-dir` only if the user insists |
| P5 | `repo-mixed` | `/ali-instructions-project --copilot-copy` | `.github/copilot-instructions.md` rendered with marker instead of archived |
