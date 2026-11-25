---
name: worktree
description: Worktree for a task — move this session into a git worktree of its own under `~/worktrees/`, on a branch named for the task, keeping the conversation; open a pull request by number in one; or list this repository's worktrees. Use when the user asks to work in a worktree, to move the current task into one, to open a PR in one, to list worktrees, or runs /ali-worktree; `ali-next-task`, `ali-merge-pr` and `ali-autopilot` hand it their worktree cases.
---

# Worktree

Work normally stays in the current checkout. This skill runs only when a worktree was asked for — by the user in this session, or by a skill the user invoked (`ali-next-task` on a busy checkout or resuming its task's worktree, `ali-merge-pr` opening the next PR beside a busy main checkout, `ali-autopilot` asked to run in a worktree). That request is the explicit instruction `EnterWorktree` needs.

What it does, in one line each:

- **A task** → a worktree at `~/worktrees/{repo}/{slug}` on the task's branch, prepared and entered by this same session ([§2](#2-create-and-enter)).
- **A PR by number** → the same, on the PR's head, for the user's own PR; another author's gets the commands instead ([§3](#3-a-pr-by-number)).
- **The task this session stands on in the main checkout** → moved into a worktree with its uncommitted work ([§4](#4-move-the-current-task)).
- **A listing** → this repository's worktrees, stale and unfinished, with ready commands ([§5](#5-the-listing)).

**It deletes nothing.** Only `ali-merge-pr` removes a worktree, and only the merged PR's one. No signal tells a live session's worktree from an abandoned one, so the listing hands the user the commands instead.

The names used below: `{main}` is the main checkout's path, `{repo}` its directory name, `{base}` the base branch, `{slug}` the branch name with `/` turned into `-`, `{path}` the worktree's directory.

**Branch names and paths go into commands single-quoted.** git accepts `$(…)`, backticks, `;`, `|` and quotes in a branch name, and others choose some of the names here — a PR's head, a contributor's branch left by `gh pr checkout`. Before the first command that uses a branch name, directly or through `{slug}` in `{path}`, the run stops on one that starts with `-` — git reads it as an option even quoted, so `git worktree add '{path}' '--detach'` silently makes a detached worktree — or holds any of `'` `"` `$` `` ` `` `;` `|` `&` `<` `>` `(` `)` `{` `}` `!`, and on a `{path}` holding `'`, which the main checkout's directory name can bring in; no command carrying it is printed. Every other branch name, the base included, and `{path}` written absolute (quotes keep a `~` from expanding) go into every command, run or printed, in single quotes — `git switch 'feat/#12-login'` — where no shell expands anything, zsh's `extendedglob` included. The listing shows a refused name's worktree without commands and without its PR.

## 1. Where the session stands

```sh
git worktree list --porcelain
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

The first entry of the listing is `{main}`; an entry marked `prunable` is a directory deleted by hand and counts as no worktree. The base branch is the caller's when it hands one over, else the repository's default (`gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`), or `origin/HEAD`'s target off GitHub.

- **Already on the task's branch** → nothing to do in its worktree; in the main checkout nothing to do either, unless the user asked to move the task — then [§4](#4-move-the-current-task).
- **In another worktree** (`--show-toplevel` is not `{main}`) → stay there until the run is about to create or enter a worktree and every check of [§2](#2-create-and-enter) that can stop it has passed; only then `ExitWorktree` with `keep`. Creating one runs git in the main checkout, which Claude Code refuses from inside a worktree, and `EnterWorktree` switches from a worktree only into `.claude/worktrees/`. A listing, or a run that stops, leaves the session where it was. A session that cannot leave prints the commands it would run and stops.
- **A temporary pair at the tip of the task's branch** — the commits [§4](#4-move-the-current-task) makes, left by a run that stopped halfway → undo it first, as §4's step 4 says: where the branch is checked out, or, checked out nowhere, inside the worktree §2 creates for it, before anything else happens there.

Before `git worktree add`, from the main checkout:

```sh
git worktree prune
```

so a worktree directory deleted by hand no longer blocks it. A run that creates or enters a worktree reports [§5](#5-the-listing)'s stale entries at the end.

## 2. Create and enter

**The branch.** Take it from the caller, or name it the way the repository names branches (`AGENTS.md`, `CONTRIBUTING.md`, recent branches), with the issue number in it when there is one; with no convention, `{N}-{short-slug}`.

**The path** is `~/worktrees/{repo}/{slug}`. When it exists and is not this branch's worktree — a same-named clone's, a fork's, a stray directory — take the first free one of `{slug}-2`, `{slug}-3`, … and write nothing into the existing one.

**An existing branch** (local, or `origin/{branch}` only) may be another author's — a contributor's branch left by `gh pr checkout`, a bot's — and that code is not this skill's to open ([§3](#3-a-pr-by-number)). Look its PR up as [§5](#5-the-listing) does, with `author` among the fields, `--limit 100` and every match counted, and a name of the `{owner}/{default branch}` shape under its full name as well, since a contributor's branch may itself be called `fix-12/main`. A PR whose `author.login` is not the `gh` user's, or a lookup that fails or fills its 100 rows, stops the run as §3 does, naming that PR or the failed lookup. GitHub records that author; a commit's author address is whatever its committer typed. No such PR, or no GitHub:

- **It has a worktree** → say it exists and where, and ask once before entering: another session may be working in it, and there is no lock to tell. A caller that names that worktree as its task's own — `ali-next-task` resuming its issue — skips the question; the `EnterWorktree` approval is the one confirmation.
- **It is checked out in the main checkout**, and this session came from another worktree → stop. The main checkout may be another session's, and only the user knows. On a clean tree there, print `git -C '{main}' switch '{base}'` for the user to run before trying again; with uncommitted changes, print no switch command — it would carry that work onto the base branch — and say the work must be committed there first.
- **Otherwise** → `git worktree add '{path}' '{branch}'`. A branch that exists only on `origin` is created from it, tracking it.

**A new branch** → off the remote base, so local commits that were never pushed stay out of the task:

```sh
git fetch origin '{base}'
git worktree add --no-track -b '{branch}' '{path}' 'origin/{base}'
```

In a repository without `origin`, from the local `{base}`.

### Prepare it

Only a worktree this run created gets items 1 and 4. Entering an existing one skips both: it was prepared when it was made, and its ignored files may be newer than the main checkout's — the very copy `ali-merge-pr` keeps a worktree for.

1. **Ignored files the build needs.** Only when `{main}/.worktreeinclude` exists — the skill never creates it. Its lines are gitignore patterns; git does the matching:

   ```sh
   git ls-files --others --ignored --exclude-from=.worktreeinclude
   ```

   Keep each listed file that `git check-ignore -q -- '{file}'` confirms is ignored (an untracked file the user is still writing is not config), and copy it to the same relative path under `{path}`, creating its directory.

2. **Files the caller hands over** — `ali-autopilot`'s plan file — come along, and the main checkout gets its copy back as it was: copy each to the same path under `{path}`, then delete the original when it is untracked, or `git restore --source=HEAD --staged --worktree -- '{file}'` when it is tracked.
3. **Enter** with `EnterWorktree` (`path: {path}`). Say first that Claude Code asks to approve the entry: outside `.claude/worktrees/` it asks every time, and no setting turns that off.
4. **Dependencies**, inside the worktree: the setup command the repository documents (`AGENTS.md`, `CONTRIBUTING.md`, README); otherwise the lockfile's package manager in frozen mode — `package-lock.json` → `npm ci`, `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`, `yarn.lock` → `yarn install --immutable` (`--frozen-lockfile` for Yarn 1), `bun.lock` or `bun.lockb` → `bun install --frozen-lockfile`; another ecosystem's lockfile likewise. No lockfile, no documented command → nothing.

**An agent without `EnterWorktree`** — Codex, Copilot, Claude Code with the worktree tools off — stops after item 2. Its sandbox lets it write only where it was started, so working on the task from the main checkout fails or asks on every edit. Print what the new session runs — `cd '{path}'`, the PR checkout when [§3](#3-a-pr-by-number) asked for one, the dependency command — and the agent to start there, and say the conversation does not come along.

### Report

Where the session now stands, on which branch, what was copied and installed — and the listing's stale entries, one line each with their command. Nothing else from the listing unless the user asked for it.

## 3. A PR by number

```sh
gh pr view {number} --json headRefName,headRepositoryOwner,isCrossRepository,baseRefName,author
gh api user --jq .login
```

**The PR's local branch** is the name `gh pr checkout` gives it: `headRefName`, or `{owner}/{headRefName}` when the PR comes from a fork (`isCrossRepository`) and `headRefName` is this repository's default branch — a fork's PR from its own `main` — `{owner}` being `headRepositoryOwner.login`. Every lookup of a PR's worktree uses that name, here, in the listing and in `ali-merge-pr`; `--branch` below pins it.

**A PR whose author is not the `gh` user is not this skill's to open.** Its tree can run code before anyone reads it and without any install: a hook under a tracked `core.hooksPath` such as `.husky` runs on checkout, and a session that enters the worktree takes its `.claude/settings.json` hooks and `.mcp.json` as its own. Stop, say why, and print the commands for the user — the first two only when that branch has no worktree yet — with a word to read the diff, `.claude/`, `.mcp.json` and hook changes included, before the checkout:

```sh
git fetch origin '{baseRefName}'
git worktree add --detach '{path}' 'origin/{baseRefName}'
gh pr diff {number}
cd '{path}'
gh pr checkout {number} --branch '{local branch}'
```

and the dependency command after them.

The user's own PR:

- **Its branch has a worktree** → [§2](#2-create-and-enter)'s existing-branch case.
- **Otherwise** → a detached worktree on the base, checked out onto the PR from inside, since `gh pr checkout` also finds a head branch this clone never had, or one in a fork:

  ```sh
  git fetch origin '{baseRefName}'
  git worktree add --detach '{path}' 'origin/{baseRefName}'
  ```

  Then [§2](#2-create-and-enter)'s preparation, with `gh pr checkout {number} --branch '{local branch}'` run inside the worktree right after entering, before the dependencies. `{slug}` comes from the local branch.

## 4. Move the current task

The session stands in the main checkout on the task's branch, and the user asked to move that task into a worktree. A branch can be checked out in one place only, so the main checkout has to leave it — and its uncommitted work has to come along rather than land on the base branch. It travels in two temporary commits on the task's branch, which only this checkout holds. The stash is the wrong carrier: its stack is shared by every worktree, so another session's entry can slip in between.

1. **An operation in progress** — `git status` (long form) says a merge, rebase, cherry-pick or revert is under way → stop, and say to finish or abort it first. The first temporary commit would consume its state (`MERGE_HEAD` and the like), and the pending merge would end up an ordinary commit.
2. **A dirty tree only** — the staged part, then the rest:

   ```sh
   git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --allow-empty -m "ali-worktree: staged"
   git add -A
   git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --allow-empty -m "ali-worktree: unstaged"
   ```

3. Free the branch and give it its worktree:

   ```sh
   git switch '{base}'
   git worktree add '{path}' '{branch}'
   ```

4. **Undo the pair**, by what the two newest commits of the branch say (`git -C '{path}' log -2 --format=%s`):

   - `ali-worktree: unstaged` over `ali-worktree: staged` →

     ```sh
     git -C '{path}' reset -q HEAD~1
     git -C '{path}' reset -q --soft HEAD~1
     ```

     The first brings the index back to what was staged with every edit in the working tree; the second puts the branch back on its old commit without touching that index.
   - `ali-worktree: staged` alone on top — a run that stopped between the two commits → only `git -C '{path}' reset -q --soft HEAD~1`; the rest never left the working tree.
   - Neither → nothing to undo. A clean tree makes no pair, so nothing is reset.

Then [§2](#2-create-and-enter)'s preparation and entry. **A failure after the first temporary commit** stops the run and says the edits are in temporary commits at the tip of `{branch}`; the next run finds them ([§1](#1-where-the-session-stands)) and undoes them with step 4, before going on — so they never ride along into a push.

## 5. The listing

Every linked worktree of this repository, from `git worktree list --porcelain` — prunable entries aside — with its PR. Both answer from wherever the session stands, so a listing never leaves the current worktree:

```sh
gh pr list --head '{head}' --state all --json number,state,headRepositoryOwner
git -C '{worktree}' status --porcelain
```

`--head` matches the branch name in every fork. A branch named `{owner}/{head}` by [§3](#3-a-pr-by-number)'s rule is looked up as `--head {head}`, keeping the newest PR whose `headRepositoryOwner` is `{owner}` — every fork's `main` shares that name. Any other branch is looked up by its own name and takes its newest PR, whoever owns the head, since a task's branch may live in the user's fork or come from a contributor's. A same-named branch in another fork can lend its PR to that lookup; at worst a worktree is listed under the wrong PR, and the listing deletes nothing. Claude Code may refuse the `git -C` from inside a worktree; then list without the clean-or-dirty column and say why.

- **Stale** — its PR is merged or closed. Print `git worktree remove '{worktree}'`; git refuses it on a dirty tree or initialized submodules, and deletes the worktree's ignored files.
- **Unfinished** — everything else: branch (or detached), clean or dirty, its PR number and state or "no PR".

A repository not on GitHub has no PR state, so all its worktrees list as unfinished. Remove nothing, whatever the listing says.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Anything that reaches GitHub or git — always English.

## Extra context

What the user or the calling skill passed — a task, a branch name, an issue or PR number, "list" — arrives below; an empty line there means no arguments were given: ask what the worktree is for, or list the worktrees when that is what was asked.

$ARGUMENTS
