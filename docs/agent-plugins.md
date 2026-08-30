# Agent plugins

Every supported agent is one ES module in `src/adapters/`, listed in `src/adapters/index.js`. The rest of the codebase knows nothing about specific agents.

## Contract

```js
import { join, resolve } from 'node:path';

/** @type {import('./index.js').Adapter} */
export default {
  id: 'new-agent',            // lowercase kebab-case, stable — used on the CLI
  aliases: ['na'],            // optional extra CLI names
  label: 'New Agent',         // shown to the user

  locations({ env, home }) {
    const configDir = env.NEW_AGENT_HOME ? resolve(env.NEW_AGENT_HOME) : join(home, '.new-agent');
    return [{ configDir, skillsDir: join(configDir, 'skills') }];
  }

  // optional: transform(skill) -> skill   reshape files for this agent only
};
```

- `configDir` — its existence is the "agent is installed" signal. **Never created by us.**
- `skillsDir` — created only when `configDir` already exists.
- `locations()` returns an array: an agent with several profiles (CLI plus IDE, or several homes) returns one entry per profile, and every profile whose `configDir` exists is synced. Do not point two profiles at directories the same agent reads, or the agent sees each skill twice.
- Adapters must not write, spawn processes, or read the network. They only compute paths.

`src/adapters/index.js` validates the contract at load time and rejects duplicate ids or aliases.

## Adding an agent

1. Add `src/adapters/<id>.js`.
2. Use the agent's documented default path and its official env var override.
3. Register it in the `adapters` array in `src/adapters/index.js`.
4. Add a row to the README table.
5. Add tests: path resolution (with and without the env var) and the missing-agent case.
6. `npm run check`.

## transform()

`transform(skill)` reshapes a skill for one agent only. It runs **before** the installer plans the write, so a transform may rename the skill and pruning still works. It must return a skill that keeps the `ali-` prefix and at least one file; anything else fails the run instead of writing something the next update would not recognize as ours. File modes carried on `skill.files[].mode` are preserved on install, so bundled scripts stay executable.

## Per-agent files inside a skill

Some agents read extra metadata from the skill directory. Codex, for example, takes a display name and a starter prompt from `<skill>/agents/openai.yaml`:

```yaml
interface:
  display_name: "Ali Review Branch"
  short_description: "Review the current branch against main"
  default_prompt: "Use $ali-review-branch to review my changes."
```

No adapter reads that file: nested files are copied verbatim, so a per-agent file needs no code here (`test/install.test.js` pins the copy, executable bit included). Ship such files in the skill itself when other agents ignore them, and use `transform()` only when a file would confuse another agent.

## Scoping a skill to some agents

A skill that is built on something only one agent can do is dead weight in the
others. `agents:` in its source frontmatter says where it belongs:

```yaml
---
name: review-pr-duo
description: …
agents: claude-code
---
```

Ids and aliases both work, comma-separated (`agents: claude-code, codex`), and
`src/skills.js` resolves them to ids when the skills are loaded. An unknown name
fails `validate` — the alternative is a skill that silently installs nowhere.
The key is stripped from the installed `SKILL.md`: it addresses this installer,
not the agent reading the skill.

The installer applies it in `sync()`, before it plans a location — so an agent
out of scope has that skill missing from its want-list, and the ordinary pruning
path removes a copy an earlier release put there. Narrowing a scope therefore
needs no migration; a plain `install` is one.

Leave the key out and the skill goes everywhere. That is the ordinary case, and
`transform()` is still the tool for a skill that needs *reshaping* per agent
rather than excluding.

## Other artifact types

Only Agent Skills are synced today. MCP servers, hooks, or native plugin manifests should be added as a separate artifact type on the same core, keeping both guarantees: never create an agent's config dir, and never touch a path that lacks our ownership marker.
