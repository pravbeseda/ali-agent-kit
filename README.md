# ali-agent-kit

[![npm](https://img.shields.io/npm/v/ali-agent-kit)](https://www.npmjs.com/package/ali-agent-kit)
[![CI](https://github.com/pravbeseda/ali-agent-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/pravbeseda/ali-agent-kit/actions/workflows/ci.yml)

Shared agent skills, distributed over npm, installed into **Claude Code**, **GitHub Copilot CLI** and **Codex CLI** at once.

Every skill is published with an `ali-` prefix: `skills/review-branch.md` in this repo becomes the skill `ali-review-branch` in each agent.

## Skills

| Skill                            | What it does                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ali-review-branch`              | Reviews the current branch against the repository's base branch — committed, staged, unstaged and untracked alike — against the same bar as `ali-review-pr`, then walks you through the findings one at a time and ends with a ready-for-a-PR verdict. |
| `ali-review-pr`                  | Reviews a pull request against one bar — does the change leave the codebase healthier — posts what fails it as inline `blocking` / `suggestion` comments, and ends with a ready-to-merge verdict. A round that posts no comment at all explains the PR in plain language instead. |
| `ali-process-pr-comments`        | Takes the unresolved review comments on a pull request one by one: verifies the claim, decides with you, applies the change, resolves the thread.                                                 |
| `ali-merge-pr`                   | Merges a finished pull request — and refuses to while a review thread is unresolved or a check failed, waiting out the pending ones — then switches the checkout to the base branch and pulls.                          |
| `ali-one-by-one`                 | Resolves the open questions in a plan one at a time — context, rated options, a recommendation, then records the decision in the plan file.                                                       |
| `ali-generate-pr-description`    | Diffs the current branch against its base branch and writes a ready-to-paste PR description, laid out in the repository's own `.github/pull_request_template.md` — checklists included, untouched — or in a neutral fallback when there is none. |
| `ali-instructions-global`        | Manual-only. Audits and tidies the user-level agent instruction files on this machine — one master `~/.agent-instructions/global.md` rendered to Claude Code, Codex and Copilot, Karpathy guidelines as a managed block, auto memory curated, every write backed up and approved first. |
| `ali-instructions-project`       | Manual-only. Audits and tidies one repository's agent instruction files — canonical `AGENTS.md`, Claude shim `.claude/CLAUDE.md`, optional Copilot copy — promotes stable auto-memory notes into it, and refuses team repositories unless authorized for the run. |

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

If your npm points at a private registry that does not mirror this package — or whose TLS chain your Node cannot verify (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) — fetch it straight from the public registry:

```sh
npx --registry=https://registry.npmjs.org/ ali-agent-kit@latest install
```

## Commands

| Command                                    | What it does                                    |
| ------------------------------------------ | ----------------------------------------------- |
| `ali-agent-kit install` (`update`, `sync`) | install/update all skills into detected agents  |
| `ali-agent-kit validate`                   | check the skills in this package, write nothing |
| `ali-agent-kit list`                       | source skills + what is installed where         |
| `ali-agent-kit agents`                     | which agents were detected, and where           |
| `ali-agent-kit uninstall`                  | remove everything this package installed        |

Options: `--agent <id[,id]>` (repeatable, accepts aliases and `all`), `--dry-run`, `--no-prune`, `-h`, `-v`.

```sh
ali-agent-kit install --agent claude,codex --dry-run
```

Exit codes: `0` ok, `1` error, `2` finished but left unmanaged paths alone.

## Supported agents

| id (aliases)             | Agent              | Skills go to         | Override             |
| ------------------------ | ------------------ | -------------------- | -------------------- |
| `claude-code` (`claude`) | Claude Code        | `~/.claude/skills/`  | `CLAUDE_CONFIG_DIR`  |
| `copilot`                | GitHub Copilot CLI | `~/.copilot/skills/` | `COPILOT_CONFIG_DIR` |
| `codex`                  | Codex CLI          | `~/.codex/skills/`   | `CODEX_HOME`         |

An agent counts as installed when its config dir exists. Missing agents are skipped, never created. Codex also reads the shared `~/.agents/skills/` directory; we deliberately do not write there, because that directory is usually owned by another skill manager and Codex would then see every `ali-*` skill twice.

## Adding a skill

Two layouts, both work:

```
skills/my-skill.md               # single file
skills/my-other-skill/SKILL.md   # directory, may carry references/, scripts/, agents/
```

```markdown
---
name: my-skill
description: One line on what the skill does. Use when the user asks for ... — this is what makes an agent trigger it.
---

# My Skill

...
```

`npm run validate` (also run by CI and by `prepublishOnly`, so a broken skill cannot be published) enforces:

- name is lowercase kebab-case, matches the file/directory name, and carries no `ali-` prefix — the prefix is added on install;
- frontmatter exists and has a non-empty `description` (that is what makes an agent trigger the skill);
- the same skill is not defined twice (`foo.md` **and** `foo/`);
- no symlinks and no `.ali-agent-kit.json` inside the source;
- no managed-file notice in the source — install adds it.

On install, the `SKILL.md` written to an agent gets that notice inserted under the frontmatter: the copy belongs to the package, and editing it in place loses the change on the next update. Sources in `skills/` stay free of it, so it is never duplicated.

### What belongs in the frontmatter

`name` and `description`, and nothing else by default. `name` is rewritten with the `ali-` prefix on install; `description` is what an agent matches to decide whether to trigger the skill. Any other key is passed through to the installed copy untouched — the loader neither reads nor validates it — so an agent-specific key can be added when an agent documents one, and `allowed-tools` is the usual example.

`user-invocable: true` used to sit in one skill and was removed. It is not what makes a skill available as `/ali-<name>`: in Claude Code the slash command comes from the skill being installed under that name, verified by invoking a skill whose frontmatter has only `name` and `description`. Four of the five skills never carried the field, so it cannot have been gating invocation for them either. Unverified for Copilot CLI and Codex CLI, where it was equally unverified while it was still there — if a slash command ever fails to appear in one of those, this is the first thing to test.

Deleting a skill file is enough to have it removed from every consumer on their next update.

Agent-specific extras live in the skill: Codex reads `agents/openai.yaml` for its display name and starter prompt, other agents ignore it.

## Adding an agent

Agents are plugins in `src/adapters/` — one file, three fields. See [docs/agent-plugins.md](docs/agent-plugins.md).

```js
export default {
  id: "cursor",
  label: "Cursor",
  locations: ({ env, home }) => [
    {
      configDir: join(home, ".cursor"),
      skillsDir: join(home, ".cursor", "skills"),
    },
  ],
};
```

Register it in the `adapters` array in `src/adapters/index.js`; the loader validates the contract and rejects duplicate ids or aliases.

## Releasing

GitHub Actions → **Publish to npm** → Run workflow → pick `patch` / `minor` / `major`.

The workflow runs `npm run check`, reads the currently published version from the registry, applies the bump **in the working copy only**, publishes with provenance, and records the release as a tag plus a GitHub release. Requires an `NPM_TOKEN` repo secret (an _automation_ token — a publish token would ask for an OTP that CI cannot provide). Only runs on `main`.

Nothing is ever committed to `main`, so the branch stays protected and every change reaches it through a pull request. The consequence: **`version` in `package.json` is a placeholder** (`0.0.0`) and is not the released version. The real one lives in the registry, in the tags, and in the badge above; published tarballs always carry the correct version.

## Checking an install

`ali-agent-kit list` shows the source skills and where each one is installed; `ali-agent-kit agents` shows which agents were detected.

Both answer from this side of the fence: the files are on disk, in a directory we own. Whether the agent actually picked a skill up is a separate question — a skill can sit in the right place with a valid marker and still be invisible (a directory that agent's version does not read, frontmatter it does not accept, a shared `~/.agents/skills/` shadowing it). Nothing here verifies that; ask the agent itself — _"list your skills"_ — or invoke one of the `ali-*` skills and see whether it triggers.
