# ali-agent-kit

Shared agent skills, distributed over npm, installed into **Claude Code**, **GitHub Copilot CLI** and **Codex CLI** at once.

Every skill is published with an `ali-` prefix: `skills/review-branch.md` in this repo becomes the skill `ali-review-branch` in each agent.

## Install / update

```sh
npx ali-agent-kit@latest install
```

Same command for both — `install` and `update` are aliases. Each run:

1. writes every skill from the package into every **detected** agent,
2. overwrites the previously installed copies,
3. deletes the skills that were removed from the package,
4. never touches skills it did not install (an ownership marker decides).

Global install if you prefer a stable binary:

```sh
npm i -g ali-agent-kit && ali-agent-kit install
npm update -g ali-agent-kit && ali-agent-kit install   # later updates
```

## Commands

| Command | What it does |
| --- | --- |
| `ali-agent-kit install` (`update`, `sync`) | install/update all skills into detected agents |
| `ali-agent-kit list` | source skills + what is installed where |
| `ali-agent-kit agents` | which agents were detected, and where |
| `ali-agent-kit uninstall` | remove everything this package installed |

Options: `--agent <id>` (repeatable, limits targets), `--dry-run`, `--no-prune`, `-h`, `-v`.

```sh
ali-agent-kit install --agent claude --dry-run
```

## Supported agents

| id | Agent | Skills go to | Override |
| --- | --- | --- | --- |
| `claude` | Claude Code | `~/.claude/skills/` | `CLAUDE_CONFIG_DIR` |
| `copilot` | GitHub Copilot CLI | `~/.copilot/skills/` | `COPILOT_CONFIG_DIR` |
| `codex` | Codex CLI | `~/.codex/skills/` | `CODEX_HOME` |

An agent counts as installed when its config dir exists. Missing agents are skipped, never created.

## Adding a skill

Two layouts, both work:

```
skills/review-branch.md          # single file
skills/hello-ali/SKILL.md        # directory, may carry references/, scripts/, assets/
```

Frontmatter needs a `description` (that is what makes the agent trigger the skill). The `name` field is rewritten to the prefixed name on install, so write it unprefixed:

```markdown
---
name: review-branch
description: Review current branch changes against main. Use when the user asks for a branch review.
---

# Review Branch
...
```

Then `npm test` and open a PR. Deleting a skill file is enough to have it removed from every consumer on their next update.

## Adding an agent

Agents are plugins in `src/adapters/`. One file, three fields:

```js
// src/adapters/cursor.js
import { join } from 'node:path';

export default {
  id: 'cursor',
  label: 'Cursor',
  configDir: (env, home) => env.CURSOR_CONFIG_DIR || join(home, '.cursor'),
  skillsDir: (configDir) => join(configDir, 'skills'),
  // optional: transform: (skill) => ({ ...skill, files: [...] })
};
```

Register it in `src/adapters/index.js`. Nothing else in the codebase knows about specific agents.

## Releasing

GitHub Actions → **Publish to npm** → Run workflow → pick `patch` / `minor` / `major`.

The workflow runs tests, bumps the version with `npm version`, publishes with provenance, pushes the commit and tag, and cuts a GitHub release. Requires an `NPM_TOKEN` repo secret (automation token).

## Testing it works

`ali-hello` ships as a smoke test. In any agent: *"use the ali hello skill"* — it prints `ali-agent-kit works ✅`, the running agent, and the path it was loaded from.
