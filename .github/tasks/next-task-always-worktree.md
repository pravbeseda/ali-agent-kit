# Every task in its own worktree, entered by the session that discussed it

## Goal
Any work in a git repository moves, before its first edit, into a worktree of its own with a branch
the agent names, inside the same session, so the discussion is kept and parallel sessions never share
a git checkout. A new `ali-worktree` skill does the move; `ali-next-task`, `ali-merge-pr` and
`ali-autopilot` use it, and nothing depends on the `Work` board.

## Facts checked (2026-11-22, Claude Code 2.1.330, git 2.54, Codex CLI 0.153.4)
- `EnterWorktree` with `path` entered `{main}/.claude/worktrees/a` from the main checkout, then
  `{main}/.claude/worktrees/b` from inside `a`, with no approval prompt; the session's working
  directory followed both times.
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
  `EnterWorktree` requires: "Before the first edit of a task in a git repository, move into its own
  worktree with the `ali-worktree` skill."
- Location → `{main}/.claude/worktrees/{slug}`, always under the main checkout's root, never nested in
  a linked worktree, because there `EnterWorktree` asks nothing, a session can switch between
  worktrees, and Codex can write; the price is that tools walking the file system see into it (see
  Known limits). Replaces `~/worktrees/{repo}/` (an approval per task, no Codex).
- Branch → named by the agent after the repository's convention, with the issue number when there is
  one; branched from `origin/{base}`.
- Ignore → `.claude/worktrees/` goes into the file `git rev-parse --git-path info/exclude` names,
  never into a tracked `.gitignore`.
- Ignored files the build needs → copied when an optional `.worktreeinclude` lists them, matched by
  git itself (`ls-files --others --ignored --exclude-from`, then `check-ignore`); the skill never
  creates that file.
- Dependencies → the setup command the repository documents, otherwise the lockfile's package
  manager in frozen mode.
- Main checkout → stays on the base branch. A clean main checkout found on another branch is switched
  back to the base branch and that branch moves into a worktree; a dirty one is left alone and the
  task is reported as not isolated.
- An existing worktree → entered only after saying it exists and asking once, because another
  session may be working in it; there is no lock to tell.
- Tracking → `git worktree list` plus each branch's PR state from `gh pr list --head`; the board only
  where a repository uses it. No registry.
- Cleanup → only `ali-merge-pr` removes a worktree, and only the merged PR's worktree the session
  itself stands in. `ali-worktree` lists stale and unfinished worktrees with ready commands and
  deletes nothing, because no signal tells a live session's worktree from an abandoned one.
- Out of scope → `ali-audit` keeps its `git switch -c audit/{date}`: it commits only its own new
  folder and runs rarely.

## Known limits
- Tools that walk the file system instead of asking git see across the boundary, both ways:
  - A test runner, linter or IDE in the main checkout picks up the worktrees (Vitest and ESLint do by
    default; `node --test` skips dot-directories). That only adds tests, so it shows red, never a
    false green; the user excludes `.claude/` once per project with the lines the README gives.
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

## Steps
- [ ] 1. New skill `worktree` (`ali-worktree`): resolve the main checkout (first entry of `git worktree list --porcelain`) and the base branch; list the worktrees under `{main}/.claude/worktrees/` as stale (PR merged or closed, with the `git worktree remove` command) or unfinished (branch, dirty or not, PR if any) and delete nothing; make sure `.claude/worktrees/` is ignored before any `git worktree add`; take the branch name from the caller or name it; an existing branch → its worktree, entered after asking once; checked out in a clean main checkout → `git switch {base}` there, then `git worktree add {path} {branch}`; in a dirty main checkout → stay and say the task is not isolated; otherwise `git worktree add {path} {branch}`; a new one → `git fetch origin {base}`, `git worktree add --no-track -b {branch} {path} origin/{base}`; copy `.worktreeinclude` matches when the file exists; install dependencies; enter with `EnterWorktree` (`path`), or use absolute paths in other agents — files: `skills/worktree/SKILL.md`, `README.md` (skills table) — lenses: security — done when: `npm run check` is green; in this repository a run from the main checkout leaves `git status` there empty and the session on the named branch with dependencies installed in the worktree itself, a second run from inside that worktree creates its sibling under the main checkout, a run for a branch checked out in a clean main checkout leaves the main checkout on the base branch and the task in a worktree, and on a repository's first run with an existing branch `git status` in the main checkout stays empty, a worktree whose PR is merged is listed, not removed, an ignored file matched by a glob entry such as `config/*.local` in `.worktreeinclude` is copied, and without that file nothing is copied and none is created
- [ ] 2. `next-task` step 4: keep the lookup by issue number, and hand creating or entering the place to `ali-worktree` with the branch name; drop the busy-checkout rule and the `../{name}-{N}` worktree; an old `../{name}-{N}` worktree is still entered (one approval prompt) — files: `skills/next-task/SKILL.md` — lenses: compatibility — done when: `npm run check` is green and step 4 creates no branch or worktree itself
- [ ] 3. `merge-pr`: find the PR's worktree by its branch in `git worktree list --porcelain`; step 6, when the session stands in it (`git rev-parse --show-toplevel` equals its path) → leave it (`ExitWorktree` `keep`; a session that cannot leave prints the command instead), keep it and say why when a `.worktreeinclude` copy differs from the main checkout's file, otherwise `git worktree remove {path}`; then in the main checkout `git pull --ff-only --prune` when it is clean on the base branch, else `git fetch origin {base} --prune`; a PR worktree the session does not stand in is left and its command printed; a PR branch checked out in the main checkout keeps today's step 6 (`git checkout {base}`, `git pull --ff-only --prune`), since the main checkout belongs on the base branch; step 7 gets the matching close lines; step 8 opens the chosen PR through `ali-worktree` instead of `gh pr checkout` — files: `skills/merge-pr/SKILL.md` — lenses: none — done when: `npm run check` is green; a merge run from the PR's worktree ends in the main checkout on the updated base with that worktree gone and the branch kept, and a run on a PR branch checked out in the main checkout ends there on the updated base
- [ ] 4. `autopilot`: a new run creates its branch through `ali-worktree` once Phase 0's discussion is done and before the plan file is written, so the file is written and committed in the worktree; a plan file handed over untracked in the main checkout is moved into the worktree first; uncommitted changes in the main checkout no longer end the run; a resumed run continues on its branch where it is checked out — files: `skills/autopilot/SKILL.md` — lenses: none — done when: `npm run check` is green, no step branches in the current checkout, and the plan file is the worktree branch's first commit while the main checkout is left as it was found
- [ ] 5. Docs: the `description` frontmatter and README rows of `next-task`, `merge-pr` and `autopilot` match; the README names the global instruction line, the optional `.worktreeinclude`, and the one-time `.claude/` exclusion for Vitest, Jest (`testPathIgnorePatterns` and `modulePathIgnorePatterns`), ESLint and the IDE — files: `skills/next-task/SKILL.md`, `skills/merge-pr/SKILL.md`, `skills/autopilot/SKILL.md`, `README.md` — lenses: none — done when: `npm run check` is green and no text still says "a worktree when the checkout is busy"
- [ ] 6. The user's global instructions (outside this repository; ask before the first write): add the trigger line to `~/.agent-instructions/global.md` and re-render with `ali-instructions-global --sync-only` — files: none in the repository — lenses: none — done when: `~/.claude/CLAUDE.md` carries the line and the drift check reports nothing

## Rulings

## Parked
