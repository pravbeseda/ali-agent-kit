# Every task in its own worktree, entered by the session that discussed it

## Goal
Any work in a git repository moves, before its first edit, into a worktree of its own with a branch
the agent names, inside the same session, so the discussion is kept and parallel sessions never share
a git checkout. A new `ali-worktree` skill does the move; `ali-next-task`, `ali-merge-pr`,
`ali-autopilot` and `ali-audit` use it, and nothing depends on the `Work` board.

## Facts checked (2026-11-22, Claude Code 2.1.330, git 2.54, Codex CLI 0.153.4)
- `EnterWorktree` with `path` entered `{main}/.claude/worktrees/a` from the main checkout, then
  `{main}/.claude/worktrees/b` from inside `a` (both created from the main checkout beforehand), with
  no approval prompt; the session's working directory followed both times.
- A session moved with `EnterWorktree` is isolated: from inside the worktree Claude Code refused
  `git -C {main} status`, and per its docs it refuses any git command aimed at the main checkout
  (`git -C`, `GIT_DIR`, a `cd` there), for the session's subagents too. Reading the main checkout's
  files and `git worktree list` still work.
- Entering a path outside `.claude/worktrees/` asks for approval every time; no permission rule
  suppresses it (Claude Code docs, worktrees page).
- `claude -w` and `EnterWorktree` with `name` always create branch `worktree-{name}`; no setting
  changes the prefix. A branch of our own needs `git worktree add -b` before `EnterWorktree` (`path`).
- A worktree entered with `path` gets no `git worktree lock`, and `ExitWorktree` never removes it.
- Codex's `workspace-write` sandbox rejects writes outside the directory it was started in.
- `git worktree remove` without `--force` refuses a dirty tree or initialized submodules, and
  deletes ignored files silently.
- `git checkout {base}` fails inside a linked worktree while `{base}` is checked out in the main one.
- With `delete_branch_on_merge`, a merged branch has no upstream left; `gh pr list --head {branch}
  --state all` still finds its PR.

## Decisions
- When → after the task is taken and discussed, before its first edit, in the same session, because
  the context is kept and the agent names the branch.
- Trigger → one line in the user's global instructions, which is also the explicit instruction
  `EnterWorktree` requires: "Before the first edit of a task in a git repository, move into that
  task's own worktree with the `ali-worktree` skill unless the session already stands in it; a
  subagent works where its parent put it."
- Location → `{main}/.claude/worktrees/{slug}`, always under the main checkout's root, never nested in
  a linked worktree, because there `EnterWorktree` asks nothing, a session can switch between
  worktrees, and Codex can edit files there; the price is that tools walking the file system see into it (see
  Known limits). Replaces `~/worktrees/{repo}/` (an approval per task, no Codex).
- Branch → named by the agent after the repository's convention, with the issue number when there is
  one; branched from `origin/{base}`, or from the local `{base}` where there is no `origin`.
- Ignore → `.claude/worktrees/` goes into the file `git rev-parse --git-path info/exclude` names,
  never into a tracked `.gitignore`.
- Ignored files the build needs → copied when an optional `.worktreeinclude` lists them, matched by
  git itself (`ls-files --others --ignored --exclude-from`, then `check-ignore`); the skill never
  creates that file.
- Dependencies → the setup command the repository documents, otherwise the lockfile's package
  manager in frozen mode.
- Main checkout → stays on the base branch, and no skill switches its branch; the only change it
  gets is a fast-forward of the base branch while it is clean on it. A task whose branch is checked
  out there, clean or dirty, stops `ali-worktree` with `git -C {main} switch {base}` for the user,
  who alone knows whether a session works there, and is then run again. `ali-merge-pr` switches only
  the checkout its own session stands in, as today.
- Git work in the main checkout → done before `EnterWorktree` or after `ExitWorktree`, never from
  inside a worktree, where Claude Code refuses it. A skill that needs it from inside a worktree
  leaves first (`ExitWorktree` `keep`); a session that cannot leave prints the command instead.
- An existing worktree → entered only after saying it exists and asking once, because another
  session may be working in it; there is no lock to tell.
- Tracking → `git worktree list` plus each branch's PR state from `gh pr list --head`; the board only
  where a repository uses it. No registry.
- Cleanup → only `ali-merge-pr` removes a worktree, and only the merged PR's worktree the session
  itself stands in. `ali-worktree` lists stale and unfinished worktrees with ready commands and
  deletes nothing, because no signal tells a live session's worktree from an abandoned one.

## Known limits
- Tools that walk the file system instead of asking git see across the boundary, both ways:
  - A test runner, linter or IDE in the main checkout picks up the worktrees (Vitest and ESLint do by
    default; `node --test` skips dot-directories). The extra tests can turn a run red or lift a
    coverage threshold, so a run in the main checkout proves nothing about a task: a task is checked
    in its own worktree, which sees none of its siblings, and in CI. The user excludes `.claude/` once
    per project with the lines the README gives.
  - Code in a worktree resolves a package it lacks from the main checkout's `node_modules`, because
    Node walks up the parents. The worktree's own install covers everything but a dependency the
    task removed; that one false green is caught by CI, which builds from a clean checkout and
    whose checks `ali-merge-pr` already waits for.
- Ignored files not listed in `.worktreeinclude` (a local database, caches) go with the worktree.
- A worktree with initialized submodules cannot be removed without `--force`; `ali-merge-pr` reports
  it and leaves it.
- An agent that cannot move its session — Codex, Copilot, or Claude Code without the worktree
  tools — runs every command with the worktree's absolute path, which stays inside the directory it
  was started in. Copilot is not verified.
- Whether another session works in an existing worktree cannot be detected: there is no lock, and a
  session's working directory is not visible from outside. The skill asks, and the user who started
  both sessions answers.

## Steps
- [ ] 1. New skill `worktree` (`ali-worktree`): a session already standing in the task's own worktree → nothing to do; standing in another worktree → `ExitWorktree` `keep` first, since everything below runs in the main checkout; resolve the main checkout (first entry of `git worktree list --porcelain`) and the base branch; run `git worktree prune`, so a worktree directory deleted by hand does not block `git worktree add`; list the worktrees under `{main}/.claude/worktrees/` as stale (PR merged or closed, with the `git worktree remove` command) or unfinished (branch, dirty or not, PR if any) and delete nothing — a repository not on GitHub has no PR state, so all its worktrees list as unfinished; make sure `.claude/worktrees/` is ignored before any `git worktree add`; take a branch name or a PR number from the caller, or name the branch; a PR number whose branch has no worktree here → `git worktree add --detach {path} origin/{base}`, then `gh pr checkout {number}` inside it, which also finds a head branch this clone never had or one in a fork; an existing branch → its worktree, entered after asking once; checked out in the main checkout → stop and print `git -C {main} switch {base}` for the user to run before trying again; otherwise `git worktree add {path} {branch}`; a new one → `git fetch origin {base}`, `git worktree add --no-track -b {branch} {path} origin/{base}`, or from the local `{base}` in a repository without `origin`; copy `.worktreeinclude` matches when the file exists; install dependencies; enter with `EnterWorktree` (`path`), or use absolute paths in other agents — files: `skills/worktree/SKILL.md`, `README.md` (skills table) — lenses: security — done when: `npm run check` is green; in this repository a run from the main checkout leaves `git status` there empty and the session on the named branch, a run for another task from inside that worktree leaves it and creates the sibling from the main checkout, a run for the same task changes nothing, in a scratch repository with a lockfile the new worktree gets its own `node_modules`, a PR number whose head branch exists only on the remote opens a worktree on that PR's commits, a run for a branch checked out in the main checkout stops with that command and changes nothing, on a repository's first run with an existing branch `git status` in the main checkout stays empty, a worktree whose PR is merged is listed, not removed, an ignored file matched by a glob entry such as `config/*.local` in `.worktreeinclude` is copied, and without that file nothing is copied and none is created
- [ ] 2. `next-task` step 4: keep the lookup by issue number, and hand creating or entering the place to `ali-worktree` with the branch name; drop the busy-checkout rule and the `../{name}-{N}` worktree; an old `../{name}-{N}` worktree is still entered (one approval prompt) — files: `skills/next-task/SKILL.md` — lenses: compatibility — done when: `npm run check` is green and step 4 creates no branch or worktree itself
- [ ] 3. `merge-pr`: find the PR's worktree by its branch in `git worktree list --porcelain`; step 1's gate (`git status --porcelain`, the `--is-ancestor` test against `headRefOid`) runs in that worktree when there is one, wherever the session stands, and stops the run when the session cannot read it; step 6, when the session stands in it (`git rev-parse --show-toplevel` equals its path) → leave it (`ExitWorktree` `keep`; a session that cannot leave prints the command instead), keep it and say why when a `.worktreeinclude` copy differs from the main checkout's file, otherwise `git worktree remove {path}`; then in the main checkout `git pull --ff-only --prune` when it is clean on the base branch, else `git fetch origin {base} --prune`; a PR worktree the session does not stand in is left and its command printed, and a session standing in another task's worktree prints the main checkout's pull command instead of running it; a PR branch checked out in the main checkout keeps today's step 6 (`git checkout {base}`, `git pull --ff-only --prune`) only when the session stands in the main checkout, and from anywhere else that checkout is left as it is and `git -C {main} switch {base}` printed; step 7 gets the matching close lines; step 8 opens the chosen PR through `ali-worktree` by its number instead of `gh pr checkout` in the current checkout — files: `skills/merge-pr/SKILL.md` — lenses: none — done when: `npm run check` is green; a run from the main checkout on a PR whose worktree holds an uncommitted change stops before merging, a merge run from the PR's worktree ends in the main checkout on the updated base with that worktree gone and the branch kept, a run from the main checkout on the PR's branch ends there on the updated base, and a run from a worktree leaves a main checkout on the PR's branch untouched and prints the command
- [ ] 4. `autopilot`: a new run creates its branch through `ali-worktree` once Phase 0's discussion is done and before the plan file is written, so the file is written and committed in the worktree; a plan file handed over untracked in the main checkout is moved into the worktree first; uncommitted changes in the main checkout no longer end the run; a resumed run finds its plan file in the worktrees under `{main}/.claude/worktrees/` and continues in the one that holds it, asking when several or none do, under step 1's main-checkout rule; `audit` writes its folder in a worktree from `ali-worktree` on branch `audit/{date}`, so committing it needs no `git switch -c audit/{date}` and no longer depends on which branch the session started on, and on a "no" that worktree stays and its path is named — files: `skills/autopilot/SKILL.md`, `skills/audit/SKILL.md` — lenses: none — done when: `npm run check` is green, neither skill branches in the current checkout, the plan file is the worktree branch's first commit, after either run the main checkout is on the base branch as it was found, a resumed run started in the main checkout continues in the existing worktree, and a subagent dispatched after `EnterWorktree` was checked, before the step is written, to work in the worktree rather than the launch directory
- [ ] 5. Docs: the `description` frontmatter and README rows of `next-task`, `merge-pr`, `autopilot` and `audit` match; the README names the global instruction line, the optional `.worktreeinclude`, and the one-time `.claude/` exclusion for Vitest, Jest (`testPathIgnorePatterns` and `modulePathIgnorePatterns`), ESLint and the IDE — files: `skills/next-task/SKILL.md`, `skills/merge-pr/SKILL.md`, `skills/autopilot/SKILL.md`, `skills/audit/SKILL.md`, `README.md` — lenses: none — done when: `npm run check` is green and no text still says "a worktree when the checkout is busy"
- [ ] 6. The user's global instructions (outside this repository; ask before the first write): add the trigger line to `~/.agent-instructions/global.md` and re-render with `ali-instructions-global --sync-only` — files: none in the repository — lenses: none — done when: `~/.claude/CLAUDE.md` carries the line and the drift check reports nothing

## Rulings

## Parked
