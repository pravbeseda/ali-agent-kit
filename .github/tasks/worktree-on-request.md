# A task in its own worktree on request, entered by the session that discussed it

## Goal
Work stays in the current checkout, as today. When the user asks for a worktree ("branch a worktree
off origin/main and do it there"), or `ali-next-task` finds the checkout busy, the session moves into
a worktree of its own, on a branch the agent names, without losing its discussion, so a task can run
in parallel with the one in the main checkout. A new `ali-worktree` skill does the move;
`ali-next-task`, `ali-merge-pr` and `ali-autopilot` use it, and nothing depends on the `Work` board.

## Facts checked (2026-11-22, Claude Code 2.1.330, git 2.54, Codex CLI 0.153.4)
- `EnterWorktree` with `path` moved the session's working directory into a worktree created
  beforehand, and from one worktree into another (checked inside `{main}/.claude/worktrees/`).
- A session moved with `EnterWorktree` is isolated: from inside the worktree Claude Code refused
  `git -C {main} status`, and per its docs it refuses any git command aimed at the main checkout
  (`git -C`, `GIT_DIR`, a `cd` there), for the session's subagents too. Reading the main checkout's
  files and `git worktree list` still work, and after `ExitWorktree` `keep` git in the main checkout
  worked again (`git worktree remove`, `git branch -d`).
- Entering a path outside `.claude/worktrees/` asks for approval every time; no permission rule
  suppresses it, only the `bypassPermissions` mode (Claude Code docs, worktrees page). No setting
  moves local worktrees elsewhere.
- `claude -w` and `EnterWorktree` with `name` always create branch `worktree-{name}`; no setting
  changes the prefix. A branch of our own needs `git worktree add -b` before `EnterWorktree` (`path`).
- A worktree entered with `path` gets no `git worktree lock`, and `ExitWorktree` never removes it.
- Vitest and ESLint in a checkout pick up a worktree nested under it; `node --test` skips
  dot-directories. Node resolves a package a nested worktree lacks from the parent's `node_modules`.
- Codex's `workspace-write` sandbox rejects writes outside the directory it was started in.
- `git worktree remove` without `--force` refuses a dirty tree or initialized submodules, and
  deletes ignored files silently.
- `git checkout {base}` fails inside a linked worktree while `{base}` is checked out in the main one.
- With `delete_branch_on_merge`, a merged branch has no upstream left; `gh pr list --head {branch}
  --state all` still finds its PR.

## Decisions
- Default → the current checkout, exactly as today. A worktree only on the user's request in the
  session, or when `ali-next-task` finds the checkout busy or the task's own worktree, where it
  already makes or uses one today, or when `ali-merge-pr`'s next PR finds the main checkout busy.
  No line in the global instructions: the user's request is the explicit instruction
  `EnterWorktree` requires, and for `ali-next-task` the skill the user invoked is.
- When → at the request, in the same session, so the discussion is kept and the agent names the
  branch.
- Location → `~/worktrees/{repo}/{slug}`, `{repo}` being the main checkout's directory name and
  `{slug}` the branch name with `/` turned into `-`, outside the repository, so no test runner,
  linter, IDE or Node resolution in the main checkout sees it and no project's config changes. The
  price is one approval on every `EnterWorktree`: on a request for a worktree, on `ali-merge-pr`'s
  next PR when the main checkout is busy, and on `ali-next-task`'s busy checkout or the task's
  worktree it finds, where today's `../{name}-{N}` asked nothing but left the session working by
  absolute paths from the main checkout. A path that already exists and is not this branch's
  worktree — a same-named clone's, a fork's — gets the next free `{slug}-2`, `{slug}-3`.
- Branch → named by the agent after the repository's convention, with the issue number when there is
  one; branched from `origin/{base}`, or from the local `{base}` where there is no `origin`.
- Ignored files the build needs → copied when an optional `.worktreeinclude` lists them, matched by
  git itself (`ls-files --others --ignored --exclude-from`, then `check-ignore`); the skill never
  creates that file.
- Dependencies → the setup command the repository documents, otherwise the lockfile's package
  manager in frozen mode.
- Main checkout → no skill switches its branch from a worktree. A branch checked out there cannot
  get a worktree: `ali-worktree` stops, on a clean tree with `git -C {main} switch {base}` for the
  user, who alone knows whether a session works there, and with uncommitted changes with no switch
  command, saying that work must be committed there first, because `git switch` would carry it onto
  the base branch. The one exception is the session standing in the main checkout on the task's
  branch and asked to move that task: it switches its own checkout, and its uncommitted changes go
  through temporary commits on the task's branch into the worktree rather than onto the base branch.
- Git work in the main checkout → done before `EnterWorktree` or after `ExitWorktree`, never from
  inside a worktree, where Claude Code refuses it. A skill that needs it from inside a worktree
  leaves first (`ExitWorktree` `keep`); a session that cannot leave prints the command instead.
- An existing worktree → entered only after saying it exists and asking once, because another
  session may be working in it; there is no lock to tell. `ali-next-task` resuming its issue skips
  the question: the user named the task, it says which worktree it enters, and the `EnterWorktree`
  approval is the one confirmation.
- Tracking → `git worktree list` plus each branch's PR state from `gh pr list --head`; the board only
  where a repository uses it. No registry.
- Cleanup → only `ali-merge-pr` removes a worktree, and only the merged PR's worktree the session
  itself stands in. `ali-worktree` lists stale and unfinished worktrees with ready commands and
  deletes nothing, because no signal tells a live session's worktree from an abandoned one.

## Known limits
- A later session for a task that lives in a worktree starts in the main checkout. The user points
  it at the task ("enter the worktree of #12", a PR number), at the price of one approval; a session
  started inside the worktree directory needs none.
- Ignored files not listed in `.worktreeinclude` (a local database, caches, a `.env`) stay in the main
  checkout.
- `ali-merge-pr` removing the merged PR's worktree deletes the ignored files in it without a word —
  a `.env` put there by hand, build output, caches (the user's choice on this PR). Only a
  `.worktreeinclude` copy that differs from the main checkout's file keeps the worktree.
- A worktree with initialized submodules cannot be removed without `--force`; `ali-merge-pr` reports
  it and leaves it.
- An agent that cannot move its session — Codex, Copilot, or Claude Code without the worktree tools,
  as with `permissions.blockWritesOutsideWorkingDirectories` — does not work on the task from the main
  checkout, since Codex's sandbox lets it write in a worktree only when started there. `ali-worktree`
  ends with the command that starts the agent in the worktree, and the discussion stays behind.
  Copilot is not verified.
- Whether another session works in an existing worktree cannot be detected: there is no lock, and a
  session's working directory is not visible from outside. The skill asks, and the user who started
  both sessions answers.

## Steps
- [x] 1. **New skill `worktree` (`ali-worktree`): its frame and listing.**
  - A session already on the task's branch → nothing to do: in its worktree always, in the current
    checkout unless the user asked to move the task into a worktree.
  - Asked to move the task it stands on in the main checkout → its uncommitted work travels in two
    temporary commits on the task's branch, never in the stash, whose stack all worktrees share:
    - a merge, rebase, cherry-pick or revert in progress → stop and say to finish or abort it
      first, since the first commit would consume its state (`MERGE_HEAD` and the like);
    - only when the tree is dirty: `git commit --no-verify --allow-empty -m "ali-worktree: staged"`
      for what is staged, then `git add -A` and the same commit with `ali-worktree: unstaged`;
    - `git switch {base}`, then step 2's `git worktree add {path} {branch}`;
    - inside the worktree, only when the branch tip is that pair: `git reset HEAD~1`, then
      `git reset --soft HEAD~1`, which leaves the branch at its old commit, the staged part staged
      and the rest uncommitted;
    - a failure after the commits stops and says the edits are in them; a later run that finds the
      pair at the tip of the task's branch undoes it the same way, wherever the branch is checked
      out, before going on.
  - Standing in another worktree → `ExitWorktree` `keep` first, since everything below runs in the
    main checkout; a session that cannot leave prints the command instead, as the Git-work decision
    says.
  - Resolve the main checkout (first entry of `git worktree list --porcelain`) and the base branch.
  - `git worktree prune`, so a worktree directory deleted by hand does not block
    `git worktree add`.
  - List this repository's linked worktrees and delete nothing:
    - stale: PR merged or closed, with the `git worktree remove` command;
    - unfinished: branch, dirty or not, PR if any;
    - a repository not on GitHub has no PR state, so all its worktrees list as unfinished.
  - **Files:** `skills/worktree/SKILL.md`, `README.md` (skills table). **Lenses:** none.
  - **Done when:** `npm run check` is green, and
    - a run for the same task from inside its worktree changes nothing;
    - a request to move the task from the main checkout, with a staged file, a modified one and a
      new untracked one, leaves the main checkout clean on the base branch and, in the worktree,
      the first file staged, the other two uncommitted and the task's branch at the commit it had
      before; the same request on a clean tree leaves every commit of the branch in place, and
      during a `git merge --no-commit` it stops with `MERGE_HEAD` still there;
    - a run from another task's worktree goes on from the main checkout;
    - a worktree whose PR is merged is listed, not removed.

- [x] 2. **`ali-worktree`: creating and entering.**
  - Take a branch name from the caller, or name the branch.
  - An existing branch:
    - with a worktree → enter it after asking once, or without asking for `ali-next-task`'s
      resume;
    - checked out in the main checkout, for a session that came from another worktree → stop as
      the Main-checkout decision says: on a clean tree
      print `git -C {main} switch {base}` for the user to run before trying again; with
      uncommitted changes print no switch and say that work must be committed there first;
    - otherwise → `git worktree add {path} {branch}`.
  - A new branch → `git fetch origin {base}`, then
    `git worktree add --no-track -b {branch} {path} origin/{base}`; in a repository without
    `origin`, from the local `{base}`.
  - A `{path}` that exists and is not this branch's worktree → the next free `{slug}-2`,
    `{slug}-3`; nothing is written into the existing directory.
  - Copy the `.worktreeinclude` matches when the file exists.
  - Install dependencies.
  - Enter with `EnterWorktree` (`path`). An agent without it stops here and prints the command that
    starts it in the worktree; the task goes on in that new session.
  - **Files:** `skills/worktree/SKILL.md`. **Lenses:** security.
  - **Done when:** `npm run check` is green, and
    - in this repository a run from the main checkout leaves `git status` there empty and the
      session in `~/worktrees/ali-agent-kit/{slug}` on the named branch, where an edit, a command
      and a commit need no approval beyond the one for entering (checked live);
    - a run for another task from inside that worktree creates the sibling from the main checkout;
    - on a repository's first run with an existing branch, `git status` in the main checkout stays
      empty;
    - a run from another worktree for a branch checked out in a clean main checkout stops with
      that command and changes nothing, and with a modified tracked file there it stops without a
      switch command and the edit stays on that branch;
    - a second clone with the same directory name gets `{slug}-2` for the same task, and the first
      clone's worktree is untouched;
    - a run where `EnterWorktree` is unavailable creates the worktree, prints the command that
      starts the agent there and edits nothing;
    - in a scratch repository with a lockfile, the new worktree gets its own `node_modules`;
    - an ignored file matched by a glob entry such as `config/*.local` in `.worktreeinclude` is
      copied, and without that file nothing is copied and none is created.

- [x] 3. **`ali-worktree`: a PR by number.**
  - The PR's branch has no worktree here → `git worktree add --detach {path} origin/{base}`, then
    `gh pr checkout {number}` inside it, which also finds a head branch this clone never had or
    one in a fork.
  - The PR's branch has a worktree → step 2's existing-branch path.
  - Then step 2's copy, install and entry, except for a PR whose author is not the `gh` user
    (`gh pr view {number} --json author`): no `.worktreeinclude` copy and no install, since both
    would hand the contributor's scripts the user's machine and secrets before the diff is read.
    The skill says so and prints the install command to run after reading it.
  - **Files:** `skills/worktree/SKILL.md`. **Lenses:** security.
  - **Done when:** `npm run check` is green, and
    - a PR number whose head branch exists only on the remote opens a worktree on that PR's
      commits with the main checkout untouched;
    - a PR by another author opens with nothing copied, nothing installed and the install command
      printed.

- [ ] 4. **`next-task` step 4.**
  - Keep the lookup by issue number. A worktree found for the issue (an old `../{name}-{N}` one
    too) is entered through `ali-worktree` without a question: step 4 says which worktree it
    enters, and the `EnterWorktree` approval is the one confirmation.
  - A clean tree on the base branch, with no worktree asked for → as today: `git switch {branch}`
    for a found branch, `git switch --no-track -c {branch} origin/{base}` for a new one.
  - Anything else — uncommitted changes, another task's branch, or the user asked for a worktree →
    `ali-worktree` with the branch name, instead of today's `../{name}-{N}` worktree.
  - **Files:** `skills/next-task/SKILL.md`. **Lenses:** compatibility.
  - **Done when:** `npm run check` is green, and
    - on a clean tree on the base branch without a request the branch is created in place, as
      today;
    - a busy checkout or a request for a worktree goes to `ali-worktree`, and step 4 creates no
      worktree itself;
    - a run on a busy checkout, with no request in the session, ends with the session in the new
      worktree through `EnterWorktree` (checked live: the invoked skill counts as the explicit
      instruction);
    - a run for an issue whose worktree exists enters it with the one approval and no question.

- [x] 5. **`merge-pr`.**
  - It runs from the PR's own worktree or from the main checkout; from any other worktree it stops
    before anything else and says where to run it.
  - Find the PR's worktree by its branch in `git worktree list --porcelain`, skipping an entry marked
    `prunable` (its directory was deleted by hand), so such a PR merges as it does today.
  - Step 1's gate (`git status --porcelain`, the `--is-ancestor` test against `headRefOid`) runs
    where the session stands, as today, and also in the PR's worktree when there is one; it stops
    the run when it cannot be read.
  - Step 6:
    - from the main checkout → today's `git checkout {base}` and `git pull --ff-only --prune`,
      whatever branch it was on; a PR worktree is left and its removal command printed;
    - from the PR's own worktree (`git rev-parse --show-toplevel` equals its path) → leave it
      (`ExitWorktree` `keep`; a session that cannot leave prints the commands instead); keep it and
      say why when a `.worktreeinclude` copy differs from the main checkout's file, otherwise
      `git worktree remove {path}`; then, in the main checkout, `git pull --ff-only --prune` when it
      is clean on the base branch, else `git fetch origin {base} --prune`, so another session's
      branch there is left alone.
  - Step 7 gets the matching close lines.
  - Step 8, by the state of the main checkout alone, wherever the run started:
    - the chosen PR's branch has a worktree → enter it through `ali-worktree`, since
      `gh pr checkout` would fail on a branch another worktree holds;
    - the main checkout is clean on the base branch → today's `gh pr checkout` there;
    - anything else (uncommitted changes, another branch) → open it through `ali-worktree` by its
      number.
  - **Files:** `skills/merge-pr/SKILL.md`. **Lenses:** none.
  - **Done when:** `npm run check` is green, and
    - a run in the main checkout on the PR's branch, with no worktrees, ends as it does today;
    - a run in the main checkout, clean on another task's branch, ends on the base branch pulled,
      and step 8 checks the next PR out in place, as today;
    - a run from the main checkout on a PR whose worktree holds an uncommitted change stops before
      merging;
    - a merge run from the PR's worktree ends in the main checkout on the updated base, with that
      worktree gone and the branch kept;
    - step 8 after such a run checks the next PR out in the main checkout when it is clean on the
      base branch, opens it in a new worktree when it is not, and enters the PR's worktree when
      its branch has one;
    - a run from another task's worktree stops before merging, names where to run it and leaves the
      session where it was.

- [x] 6. **`autopilot` in a worktree.**
  - A run the user asked to put in a worktree gets its branch from `ali-worktree` at the point where
    §3 branches today; the plan file written in the main checkout is moved into the worktree and
    committed there as the branch's first commit, and uncommitted changes in the main checkout do
    not end such a run.
  - Every other run branches and resumes as today.
  - **Files:** `skills/autopilot/SKILL.md`. **Lenses:** none.
  - **Done when:** `npm run check` is green, and
    - without a request §3 is unchanged;
    - with one, the plan file is the worktree branch's first commit and the main checkout is as it
      was found;
    - a subagent dispatched after `EnterWorktree` was checked, before the step is written, to work
      in the worktree rather than the launch directory.

- [x] 7. **Docs.**
  - The `description` frontmatter and README rows of `next-task`, `merge-pr` and `autopilot` match.
  - The README names:
    - how to ask for a worktree, and that the default stays the current checkout;
    - where worktrees go and the one approval on every entry;
    - the optional `.worktreeinclude`;
    - that `ali-merge-pr` removes the merged PR's worktree with the ignored files in it, and
      `ali-worktree` lists the rest.
  - **Files:** `skills/next-task/SKILL.md`, `skills/merge-pr/SKILL.md`,
    `skills/autopilot/SKILL.md`, `README.md`. **Lenses:** none.
  - **Done when:** `npm run check` is green, and no text still says a new worktree goes to
    `../{name}-{N}`.

## Rulings
- Step 2's order is copy → enter → (PR checkout) → install, not copy → install → enter. Installing
  and `gh pr checkout` inside the entered worktree need no `cd {path} &&`, which Claude Code's guard
  turns into an extra prompt; the copy stays before entering because it runs git in the main
  checkout. An agent without `EnterWorktree` gets the remaining commands printed.
- The temporary commits run with `--no-verify` and `-c commit.gpgsign=false`: hooks and signing
  must not block or prompt on two commits undone a moment later. Claude Code's own note on entering
  a worktree recommends a temporary commit over the shared stash, as step 1 does.
- Live check (2026-11-23, Claude Code 2.1.330, git 2.54), in this repository: `EnterWorktree` with
  a path under `~/worktrees/ali-agent-kit/` moved the session; an edit, a command and a commit there
  raised no further prompt; `git -C {main}` from inside was refused; a subagent dispatched after
  entering ran in the worktree (`pwd`, `--show-toplevel`, a file write); `ExitWorktree` `keep` came
  back and git in the main checkout worked again. The session ran in auto mode, so whether the entry
  itself showed an approval prompt was not observed here.
- Checked in scratch repositories, git only: the move with a staged, a modified and an untracked
  file; a clean tree keeping its commits; a pending merge seen before any commit; a
  `.worktreeinclude` glob copying only ignored files; the `{slug}-2` suffix next to a stray
  directory; a remote-only branch created tracking `origin`; `npm ci` giving the worktree its own
  `node_modules`; a `prunable` entry; the worktree gate; removal when the include copies match and
  keeping when one differs; undoing a lone `ali-worktree: staged` commit with one soft reset.
- Review suggestion to replace step 3's detached worktree with `gh pr checkout --worktree`: not
  taken. The flag needs gh 2.102 (2026-09-30), and the written path works with any gh; step 3 now
  passes `--branch` instead, so a fork's `main` cannot be mistaken for this repository's.

## Parked
- Step 4 stays open: whether a model running `ali-next-task` on a busy checkout calls
  `EnterWorktree` when the user never said "worktree". The tool's description allows it only on the
  user's word or an instruction in `CLAUDE.md` or memory, and this session could not test the new
  skill text without installing it. Verify after release in a fresh session with a dirty checkout;
  if the model refuses, `ali-next-task` asks one question ("open it in a worktree?") whose answer
  is the user's word.
- End-to-end runs with the released skills, not done here: a PR by number whose head exists only
  on the remote, and one by another author (step 3); `ali-merge-pr` from a PR's worktree, and its
  step 8 beside a busy main checkout (step 5); an `ali-autopilot` run asked to go into a worktree
  (step 6); the agent-without-`EnterWorktree` path on Codex (step 2).
