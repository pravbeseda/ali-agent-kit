# ali-agent-kit

[![npm](https://img.shields.io/npm/v/ali-agent-kit)](https://www.npmjs.com/package/ali-agent-kit)
[![CI](https://github.com/pravbeseda/ali-agent-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/pravbeseda/ali-agent-kit/actions/workflows/ci.yml)

Shared agent skills, distributed over npm, installed into **Claude Code**, **GitHub Copilot CLI** and **Codex CLI** at once.

Every skill is published with an `ali-` prefix: `skills/review-branch.md` in this repo becomes the skill `ali-review-branch` in each agent.

## Install / update

```sh
npx ali-agent-kit@latest install
```

Same command for both — `install` and `update` are aliases. Each run:

1. writes every skill from the package into every **detected** agent,
2. replaces the previously installed copies **atomically** (staging dir + `rename`, rolled back on failure — an interrupted run never leaves a half-written skill),
3. deletes the skills that were removed from the package,
4. never touches skills it did not install (an ownership marker decides), and exits with code `2` if it had to leave any such path alone.

Global install if you prefer a stable binary:

```sh
npm i -g ali-agent-kit && ali-agent-kit install
npm update -g ali-agent-kit && ali-agent-kit install   # later updates
```

## Commands

| Command | What it does |
| --- | --- |
| `ali-agent-kit install` (`update`, `sync`) | install/update all skills into detected agents |
| `ali-agent-kit validate` | check the skills in this package, write nothing |
| `ali-agent-kit list` | source skills + what is installed where |
| `ali-agent-kit agents` | which agents were detected, and where |
| `ali-agent-kit uninstall` | remove everything this package installed |

Options: `--agent <id[,id]>` (repeatable, accepts aliases and `all`), `--dry-run`, `--no-prune`, `-h`, `-v`.

```sh
ali-agent-kit install --agent claude,codex --dry-run
```

Exit codes: `0` ok, `1` error, `2` finished but left unmanaged paths alone.

## Supported agents

| id (aliases) | Agent | Skills go to | Override |
| --- | --- | --- | --- |
| `claude-code` (`claude`) | Claude Code | `~/.claude/skills/` | `CLAUDE_CONFIG_DIR` |
| `copilot` | GitHub Copilot CLI | `~/.copilot/skills/` | `COPILOT_CONFIG_DIR` |
| `codex` | Codex CLI | `~/.codex/skills/` | `CODEX_HOME` |

An agent counts as installed when its config dir exists. Missing agents are skipped, never created. Codex also reads the shared `~/.agents/skills/` directory; we deliberately do not write there, because that directory is usually owned by another skill manager and Codex would then see every `ali-*` skill twice.

## Adding a skill

Two layouts, both work:

```
skills/review-branch.md          # single file
skills/hello/SKILL.md            # directory, may carry references/, scripts/, agents/
```

```markdown
---
name: review-branch
description: Review current branch changes against main. Use when the user asks for a branch review.
---

# Review Branch
...
```

`npm run validate` (also run by CI and by `prepublishOnly`, so a broken skill cannot be published) enforces:

- name is lowercase kebab-case, matches the file/directory name, and carries no `ali-` prefix — the prefix is added on install;
- frontmatter exists and has a non-empty `description` (that is what makes an agent trigger the skill);
- the same skill is not defined twice (`foo.md` **and** `foo/`);
- no symlinks and no `.ali-agent-kit.json` inside the source.

Deleting a skill file is enough to have it removed from every consumer on their next update.

Agent-specific extras live in the skill: Codex reads `agents/openai.yaml` for its display name and starter prompt (see `skills/hello/`), other agents ignore it.

## Adding an agent

Agents are plugins in `src/adapters/` — one file, three fields. See [docs/agent-plugins.md](docs/agent-plugins.md).

```js
export default {
  id: 'cursor',
  label: 'Cursor',
  locations: ({ env, home }) => [
    { configDir: join(home, '.cursor'), skillsDir: join(home, '.cursor', 'skills') }
  ]
};
```

Register it in the `adapters` array in `src/adapters/index.js`; the loader validates the contract and rejects duplicate ids or aliases.

## Releasing

GitHub Actions → **Publish to npm** → Run workflow → pick `patch` / `minor` / `major`.

The workflow runs `npm run check`, reads the currently published version from the registry, applies the bump **in the working copy only**, publishes with provenance, and records the release as a tag plus a GitHub release. Requires an `NPM_TOKEN` repo secret (an *automation* token — a publish token would ask for an OTP that CI cannot provide). Only runs on `main`.

Nothing is ever committed to `main`, so the branch stays protected and every change reaches it through a pull request. The consequence: **`version` in `package.json` is a placeholder** (`0.0.0`) and is not the released version. The real one lives in the registry, in the tags, and in the badge above; published tarballs always carry the correct version.

## Testing it works

`ali-hello` ships as a smoke test. In any agent: *"use the ali hello skill"* — it prints `ali-agent-kit works ✅`, the running agent, and the path it was loaded from.
