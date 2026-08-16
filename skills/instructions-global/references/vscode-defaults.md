# VS Code chat customization settings — defaults by version

Used by `scripts/lib/vscode.js` (`loadDefaults`) to fill in keys that a
`settings.json` does not set explicitly. The `since` version is the first
release the default applies from; a key absent from a settings file that is
older than every `since` row is reported as "unknown, confirm via diagnostics".

Verified 2026-08-16 against the VS Code settings reference and release notes
(https://code.visualstudio.com/docs/agent-customization/custom-instructions,
https://code.visualstudio.com/docs/agents/concepts/agent-host,
https://code.visualstudio.com/updates). Re-verify when a warning says
"unknown": the release cadence is weekly and defaults move.

```json
{
  "defaults": [
    { "key": "chat.useClaudeMdFile", "since": "1.109.0", "value": true, "note": "covers root CLAUDE.md, .claude/CLAUDE.md, ~/.claude/CLAUDE.md, CLAUDE.local.md; @imports are not documented as expanded" },
    { "key": "chat.useAgentsMdFile", "since": "1.104.0", "value": true, "note": "root AGENTS.md; nested files need chat.useNestedAgentsMdFiles" },
    { "key": "chat.useNestedAgentsMdFiles", "since": "1.105.0", "value": false, "note": "experimental" },
    { "key": "chat.instructionsFilesLocations", "since": "1.100.0", "value": { ".github/instructions": true }, "note": "object path -> bool, ~ allowed; docs disagree on whether ~/.copilot/instructions and ~/.claude/rules are in the default — set it explicitly" },
    { "key": "chat.agentHost.enabled", "since": "1.129.0", "value": false, "note": "opt-in per the 1.129-1.131 release notes; the settings reference does not print a default (NOT VERIFIED)" },
    { "key": "chat.agents.claude.preferAgentHost", "since": "1.128.0", "value": true, "note": "experimental; only matters when chat.agentHost.enabled is on" }
  ]
}
```

## What each key means for these skills

| Key | Wanted value | Why |
|---|---|---|
| `chat.useClaudeMdFile` | `false` | VS Code Copilot is treated as a Copilot-family reader; with `true` it would also read `~/.claude/CLAUDE.md` and the project shim — the same text twice |
| `chat.instructionsFilesLocations` | contains `"~/.copilot/instructions": true` | the classic extension then reads the one Copilot user-level file; the Agent Host Copilot harness reads that folder anyway |
| `chat.useAgentsMdFile` | leave | root `AGENTS.md` is the project canon; must stay readable |
| `chat.agentHost.enabled` | leave | detection only — the configuration above is valid with the Agent Host on or off |
| `chat.agents.claude.preferAgentHost` | leave | detection only |

Diagnostics: right-click the Chat view → **Diagnostics** shows which instruction files were loaded for the last request; `Chat: Configure Instructions` lists the discovered files with their source.
