# Skills that work inside a worktree made elsewhere

## Goal
Worktrees are made by the user — by hand or by a terminal app's "new worktree" action, Herdr's
included — and the skills work inside them instead of making and managing their own. Work stays in
the current checkout as today.

## Facts checked (2026-11-22, git 2.54, Claude Code 2.1.330)
- `git checkout {base}` fails inside a linked worktree while `{base}` is checked out in the main one.
- A session Claude Code moved into a worktree with `EnterWorktree` is refused git aimed at the main
  checkout. Per the tool's description that applies to a moved session, not to one started in the
  worktree directory — read, not run.
- `git worktree remove` without `--force` refuses a dirty tree, and deletes ignored files silently.

## Decisions
- No skill creates, enters or removes a worktree beyond what `ali-next-task` already does on a busy
  checkout (`../{name}-{N}`).
- `ali-next-task` in a fresh worktree — not the main checkout, clean, no commits beyond
  `origin/{base}` — creates the task's branch there; the branch it was on is left, with its
  delete command.
- `ali-merge-pr` run from a worktree switches nothing: it pulls the base branch in the main checkout
  when that is clean and on it, otherwise fetches, and leaves the worktree for whoever made it,
  naming the app's delete action and `git worktree remove`.
- `ali-merge-pr` checks the PR's worktree for uncommitted or unpushed work before merging, wherever
  the session stands.
- `ali-merge-pr` step 8 run from a worktree lists the user's open PRs without offering to switch
  that worktree to one: it belongs to one task.

## Steps
- [x] 1. `next-task` step 4: the fresh-worktree rule — files: `skills/next-task/SKILL.md` — done
  when: the rule sits between "clean tree on the base branch" and "anything else", and
  `npm run check` is green.
- [x] 2. `merge-pr`: the worktree lookup and gate in step 1, the worktree arm of step 6, its
  `Now on` line — files: `skills/merge-pr/SKILL.md` — done when: step 6 never runs
  `git checkout` in a worktree and `npm run check` is green.
- [x] 3. README rows for both skills — files: `README.md`.

## Rulings
- PR #80 first added an `ali-worktree` skill that made, entered, moved into and listed worktrees
  through `EnterWorktree`, and wired `ali-next-task`, `ali-merge-pr` and `ali-autopilot` to it.
  The full review at 1c3fad1 found it duplicated the terminal app that already owns the worktree
  lifecycle, kept the conversation only for a Claude Code session moved by the skill, and left a
  session started inside a worktree with printed commands; it was narrowed to the decisions above.

## Parked
- Not run live: `/ali-next-task` in a worktree made by Herdr's "New worktree", and `/ali-merge-pr`
  from one.
