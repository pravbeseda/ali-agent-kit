# `~/.agent-instructions/config.json`

Optional. Missing keys take the defaults below (`scripts/lib/config.js`,
`DEFAULT_CONFIG`); unknown keys are kept. Written by hand or by the skill after
the user asks for a change — never silently.

```json
{
  "thresholds": {
    "master_lines": 150,
    "project_lines": 200,
    "memory_index_lines": 200,
    "codex_budget_bytes": 24576,
    "codex_cap_bytes": 32768
  },
  "retention": 10,
  "karpathy": {
    "enabled": true,
    "source": "https://raw.githubusercontent.com/multica-ai/andrej-karpathy-skills/refs/heads/main/skills/karpathy-guidelines/SKILL.md",
    "pin": null
  },
  "disabled_surfaces": [],
  "git_emails": [],
  "git_logins": [],
  "copilot_copy": false
}
```

| Key | Meaning |
|---|---|
| `thresholds.master_lines` | soft limit for the master; a warning and a question, never a cut |
| `thresholds.project_lines` | same for a project's `AGENTS.md` |
| `thresholds.memory_index_lines` | `MEMORY.md` is kept at or under this (Claude loads the first 200 lines / 25 KB) |
| `thresholds.codex_budget_bytes` | early warning for the Codex chain (global `AGENTS.md` + project `AGENTS.md`) |
| `thresholds.codex_cap_bytes` | Codex `project_doc_max_bytes` default, reported next to the warning |
| `retention` | backup runs kept under `~/.agent-instructions/backups/`; older runs are pruned after a successful apply |
| `karpathy.enabled` | `false`: the block is neither inserted nor updated; its state is still reported |
| `karpathy.source` | upstream URL of the SKILL.md whose body is the block |
| `karpathy.pin` | a ref (commit sha or date) — when set, upstream changes are reported but no update is proposed |
| `disabled_surfaces` | surface ids to skip: `claude`, `codex`, `copilot-cli`, `jetbrains`, `vscode` |
| `git_emails` | the user's other commit emails; the gate does not count them as "other authors" |
| `git_logins` | the user's GitHub logins; a remote owned by one of them is personal, `<login>@users.noreply.github.com` is the user |
| `copilot_copy` | default for `--copilot-copy` in `instructions-project` |

Environment overrides read by the scripts: `AGENT_INSTRUCTIONS_DIR` (the store,
default `~/.agent-instructions`), `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
`COPILOT_HOME`, `COPILOT_CUSTOM_INSTRUCTIONS_DIRS` (reported), `HOME` /
`USERPROFILE`.

## `state.json`

Written by `apply.js` (global) after a successful run — never by hand:

```json
{
  "version": 1,
  "runs": [{ "runId": "20260816-143030-b735", "skill": "instructions-global", "at": "…", "files": 6, "config": { } }],
  "targets": { "/home/me/.claude/CLAUDE.md": { "sha256": "…", "runId": "…", "at": "…" } },
  "master": { "hash": "…", "runId": "…" }
}
```

`targets` hashes are what `drift.js` compares against; `master.hash` tells
whether the master was edited by hand since the last render. Project runs add
only a `runs` entry (drift there is read from the shim marker; no state lives in
a repository).

## Run and backup layout

```
~/.agent-instructions/
  global.md                 the master
  config.json  state.json  parked.md
  runs/<run-id>/            inventory.json plan.json render.json labels.json
                            proposal/  diff/  report-tables.md  report.md
  backups/<run-id>/         manifest.json + home/<relative path> mirrors  (last N runs)
  archive/<run-id>/         retired files and superseded memory (never pruned)
```
