# `ali-next-task` always works in a worktree, and worktrees are tracked and cleaned up

## Goal
Every task taken with `ali-next-task` gets its own worktree outside the repository, so several
sessions can work and commit in parallel while the main checkout stays untouched; finished
worktrees are removed on merge, and leftovers are found and cleaned at the next task.

## Facts checked
- Claude Code `EnterWorktree` with `path` moves the session into any worktree registered in
  `git worktree list` of the current repository on first entry; `ExitWorktree` never removes a
  worktree entered that way, and `keep` returns the session to the launch directory.
- `EnterWorktree` does not process `.worktreeinclude` (only `claude --worktree` and the desktop app
  do), so the skill copies those files itself.
- `.worktreeinclude`: `.gitignore` syntax, at the repository root; a listed file is copied only when
  git also ignores it.
- `git checkout {base}` fails inside a linked worktree while `{base}` is checked out in the main
  one, which is what `merge-pr` step 6 runs today.

## Decisions
- Where a task runs → always in a worktree; the main checkout is never switched, whatever its
  state, because parallel sessions in one directory collide and a clean main checkout keeps every
  next run simple.
- Location → `~/worktrees/{repo}/{N}-{slug}`, fixed, no setting, because outside the repository no
  tool of the main checkout (`tsc`, test runners, IDE indexers) sees it, and `ls ~/worktrees` shows
  unfinished work across all repositories. Known limit: two repositories with the same name under
  different owners share one `{repo}` folder.
- Not `.claude/worktrees/` → a nested directory is seen by tools that ignore `.gitignore`.
- Session directory → Claude Code enters the worktree with `EnterWorktree` (`path`); other agents
  run every command with the worktree's absolute path.
- The global "never change another project" rule → the skill states that the worktree is a checkout
  of the same repository; the user's global instructions stay unchanged.
- Ignored files the build needs (`.env`, `local.properties`) → copied from the main checkout when an
  optional `.worktreeinclude` lists them; the skill never creates that file, not even empty.
- Dependencies → the setup command the repository documents (`AGENTS.md`, README, `CONTRIBUTING.md`),
  otherwise the lockfile's package manager in frozen mode; nothing for Gradle, whose cache is shared.
- Tracking → no new registry: the board's `In progress` says which tasks are unfinished,
  `git worktree list` says where their files are, the issue number in the name links the two.
- Cleanup → `merge-pr` removes the merged PR's worktree; `next-task` removes leftovers before
  picking. Only a worktree that is clean, has nothing unpushed and whose PR is merged or closed is
  removed — its commits live on the remote branch. Branches are never deleted.

## Steps
- [ ] 1. `next-task` step 4: every task gets a worktree at `~/worktrees/{repo}/{N}-{slug}` from `origin/{base}`; the lookup for an existing place stays and still finds an old `../{name}-{N}` worktree or a main checkout already on the task's branch; an existing branch without a worktree gets `git worktree add` instead of `git switch`; the session enters the worktree; the skill says it is the same repository, not another project — files: `skills/next-task/SKILL.md` — lenses: compatibility — done when: `npm run check` is green, step 4 has no path that switches the main checkout, and the old-layout cases are named
- [ ] 2. `next-task`: prepare a new worktree — copy the files `.worktreeinclude` lists that git ignores, only when the file exists; run the documented setup command or the lockfile install; when a build fails on a missing ignored file, name it and mention `.worktreeinclude`, never create it — files: `skills/next-task/SKILL.md` — lenses: security — done when: `npm run check` is green; in a test repository an ignored `.env` listed in `.worktreeinclude` appears in the new worktree, and without the file nothing is copied and no file is created
- [ ] 3. `next-task`: audit the repository's linked worktrees before showing candidates — prunable → `git worktree prune`; uncommitted or unpushed work → listed as unfinished above the candidates, `#N` resumes it; open PR → listed as in review; PR merged or closed, clean, nothing unpushed → `git worktree remove` without `--force`, reported; the main checkout is never touched — files: `skills/next-task/SKILL.md` — lenses: none — done when: `npm run check` is green; in a test repository with one merged-and-clean and one dirty worktree the first is removed and the second is listed
- [ ] 4. `merge-pr` step 6: in a linked worktree (`git rev-parse --git-dir` differs from `--git-common-dir`), skip `git checkout {base}`; leave the worktree (`ExitWorktree` `keep` when this session entered it), remove it with `git -C {main} worktree remove {path}`, `git fetch origin {base} --prune`; a session that cannot leave the directory prints the command instead and relies on the `next-task` audit; step 7 gets the matching close line — files: `skills/merge-pr/SKILL.md` — lenses: none — done when: `npm run check` is green; a merge run from a worktree ends with the worktree gone, the branch kept and no failed checkout
- [ ] 5. Docs: both skills' `description` frontmatter and their README rows match the new behaviour; one README line names `~/worktrees/{repo}/` and the optional `.worktreeinclude` — files: `skills/next-task/SKILL.md`, `skills/merge-pr/SKILL.md`, `README.md` — lenses: none — done when: `npm run check` is green and no text still says "a worktree when the checkout is busy"

## Rulings

## Parked
