---
name: merge-pr
description: Merge a pull request that is done, and refuse to while anything is still open — no unresolved review thread, no failing check, pending ones waited out — then switch the checkout to the base branch and pull — or, run from the PR's own worktree, remove it and update the main checkout — and point at what to work on next. Use when the user asks to merge, land or finish a PR, or runs /ali-merge-pr.
---

# Merge PR

Land a pull request whose work is finished. The skill answers one question — **is there anything left that would make this merge premature?** — and acts on the answer: it merges when there is nothing, and it stops with a named blocker when there is.

> **Not `ali-review-pr`:** that skill judges the change and posts findings. This one assumes the judging is done and only checks that nothing is still open.
> **Not `ali-process-pr-comments`:** that skill triages review threads. This one refuses to merge while any thread is unresolved and hands them there.

**This skill fixes nothing** — with one exception: a branch the base branch's protection rejects as out of date is brought up to date ([step 2](#a-branch-that-is-behind-gets-updated)). It does not edit code, does not reply to comments, does not resolve threads and does not rerun a failed job. Every blocker it finds ends the run with a message naming what to do next.

## Step 1. Resolve the PR and the local state

Fetch in parallel:

```sh
gh pr view --json number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,headRefOid,headRepositoryOwner,isCrossRepository,baseRefName
gh repo view --json nameWithOwner,defaultBranchRef --jq '{repo: .nameWithOwner, default: .defaultBranchRef.name}'
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

`gh pr view` without an argument resolves the PR of the current branch; pass the number explicitly when the user named one. If it fails because the branch has no open PR, **stop** and ask which PR to land.

Every field is used later: `title` and `number` in the close block, `headRefOid` as the merge guard in step 5, `baseRefName` in step 6.

### Where the run stands

```sh
git worktree list --porcelain
git rev-parse --show-toplevel
```

The first entry is the main checkout. The PR's local branch is the name `gh pr checkout` gives it — `headRefName`, or `{owner}/{headRefName}` when the PR comes from a fork (`isCrossRepository`) and `headRefName` is the repository's default branch — a fork's PR from its own `main` (`{owner}` is `headRepositoryOwner.login`). The PR's worktree is the entry on that branch; an entry marked `prunable` is a directory deleted by hand and counts as none.

- **The session stands in the main checkout or in the PR's own worktree** → go on.
- **In any other worktree** → stop before anything else, and say to run it from the main checkout or from the PR's worktree, naming both paths. Step 6 needs git in the main checkout, which Claude Code refuses from inside a worktree, and leaving this one would drop another task's session out of its directory.

### The working tree has to be clean

`git status --porcelain` is non-empty → **stop, before anything is merged**. Report the paths.

This applies whatever branch the checkout is on, for two different reasons:

- **On the PR's own branch** (its local branch, as above, equals the current branch) the dirt is work belonging to this PR that GitHub has never seen. Merging leaves it stranded on a branch nobody will look at again.
- **On any other branch** it is unrelated work that step 6 would drag onto the base branch, or that would make the `git checkout` fail outright.

When the checkout **is** the PR's branch, one more check: is the commit on disk the commit that is about to be merged?

```sh
git fetch origin refs/pull/{number}/head
git rev-parse HEAD
git merge-base --is-ancestor HEAD {headRefOid}
```

Compare against `headRefOid` — the PR's head — and nothing else. Not against `@{upstream}`: a tracking ref points wherever the branch was configured to point, which is not necessarily this PR's branch, and a stale or unrelated one answers zero to the question that mattered. `headRefOid` is the commit GitHub will merge, so it is the only thing worth comparing to. The `fetch` is what puts that object in the local repository for the test.

**Fetch the pull ref, not `origin {headRefName}`.** A branch of that name need not exist on `origin` at all: on a PR from a fork the head branch lives in the contributor's repository, and on a PR that is already merged the repository may have deleted it. `refs/pull/{number}/head` is served by the base repository for every PR, fork or not, and outlives the head branch — so the object the test needs is always there, and `--is-ancestor` cannot fail on a missing commit.

If the fetch itself fails — no network, no access — that is the one case with no reading: say the gate could not be answered and stop, rather than merging on an unchecked assumption.

Two outcomes otherwise, and they are not the same:

- **`HEAD` equals `headRefOid`, or `--is-ancestor` exits `0`** — the checkout is the PR head or merely behind it. Nothing local is at risk. Say the checkout is behind, if it is, and go on.
- **`--is-ancestor` exits `1`** — the checkout holds commits the PR does not. Those are exactly the commits the merge would exclude and then orphan. Report `HEAD` and `headRefOid` and stop.

**The PR's worktree gets the same gate** when the session does not stand in it: `git -C {worktree} status --porcelain` must be empty, and its `HEAD` (`git -C {worktree} rev-parse HEAD`) must equal `headRefOid` or be its ancestor (`git merge-base --is-ancestor`, after the same `fetch`). Uncommitted work or commits there are this PR's work GitHub never saw, exactly as on the PR's branch here. Either command failing stops the run as an unanswered gate.

The whole gate sits here rather than in step 6 on purpose: a merge cannot be taken back, so the state that would make it wrong is checked while it still can be.

### Only then, what state the PR is in

The gate above runs first and runs for every state — including the two that skip most of this skill. A `git checkout` onto the base branch carries a dirty tree with it whatever the reason for the switch, so the branch the PR is in has no say in whether that check happens.

- **`state` is `OPEN`** → go on to step 2.
- **`state` is `MERGED`** → somebody merged it already. Steps 2 to 5 have nothing left to do: skip them, run [step 6](#step-6-switch-the-checkout-to-the-base-branch) — the checkout still wants moving off a branch that has landed — and close with the `ALREADY MERGED` block, which claims no check and no thread this pass never looked at. That block names who landed it and when, so read the two fields for it: `gh pr view {number} --json mergedAt,mergedBy`.
- **`state` is `CLOSED`** → the PR was closed unmerged. Say so and end the pass; do not switch branches, and do not reopen it.

## Step 2. Blockers on the PR itself

Read the fields from step 1:

- **`isDraft` is true** → stop. A draft is not finished, whatever its checks say.
- **`reviewDecision` is `CHANGES_REQUESTED`** → stop, and name the reviewer.
- **`reviewDecision` is `REVIEW_REQUIRED`** → stop. The branch protection will refuse the merge anyway; saying so up front beats a failed `gh pr merge`.
- **`reviewDecision` is `APPROVED` or empty** → not a blocker. Empty means the repository asks for no review at all, which is a policy, not an omission — do not invent an approval requirement the repository does not have.
- **`mergeable` is `CONFLICTING`** → stop. The branch needs rebasing onto its base — the author's call, not this skill's.
- **`mergeStateStatus` is `BEHIND`** → not a blocker: update the branch, as below, without asking.
- **`mergeable` is `UNKNOWN`** → GitHub is still computing it. Re-read `gh pr view --json mergeable,mergeStateStatus` a few seconds later before deciding anything.

### A branch that is behind gets updated

`BEHIND` means the base branch's protection requires branches to be up to date and this one is not — the merge would be refused, and the fix is mechanical. Invoking this skill authorizes it, so update the branch and say so in one line:

```sh
gh pr update-branch {number}
```

**Merge the base in; never pass `--rebase`.** A rebase rewrites the author's commits and force-pushes their branch; a merge commit only adds one on top.

**A failed update stops the run.** Report `gh`'s message verbatim: a conflict is the author's to resolve, exactly like `CONFLICTING`, and a fork that does not allow maintainer edits is the contributor's to update.

After a successful update the PR has a new head commit, so re-read it:

```sh
gh pr view {number} --json headRefOid,mergeable,mergeStateStatus
```

That `headRefOid` replaces the one from step 1 everywhere below — it is the commit the checks now run on and the one step 5 guards the merge with.

`mergeStateStatus` values `BLOCKED` and `UNSTABLE` are **not** read as blockers here, and the reason is worth knowing: `BLOCKED` usually restates a missing review or a check still running, which steps 3 and 4 diagnose far better than one opaque word, and `UNSTABLE` means only non-required checks are failing — which this skill still refuses to merge past, from step 4, on its own terms. Report the value when the run stops, never decide on it alone.

## Step 3. Unresolved review threads

Load every thread, and page through — a truncated list looks exactly like a clean PR:

```sh
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 1) { nodes { author { login } body } }
        }
      }
    }
  }
}' -F owner={owner} -F repo={repo} -F number={number}
```

While `pageInfo.hasNextPage`, repeat with `-F cursor={endCursor}`.

**Any thread with `isResolved: false` stops the run** — including an outdated one. `isOutdated` means the line moved, not that the point was answered; a thread nobody resolved is a thread nobody answered. Do not resolve threads here to clear the way, and do not judge whether a comment was worth acting on: that judgement is `ali-process-pr-comments`, and this skill's job is only to see that it happened.

Report them as one compact list — `path:line`, author, the first line of the comment — and end the run pointing at `ali-process-pr-comments`.

## Step 4. Checks — wait for the pending ones

```sh
gh pr checks {number} --json name,bucket,state,link
```

`bucket` sorts every check into `pass`, `fail`, `pending`, `skipping` or `cancel`. The exit code says roughly the same thing in one number: `0` all done and passing, `8` something is still pending, `1` something failed **or** the PR has no checks at all. Those last two are different outcomes behind one code, so **read the JSON, not the exit code** — and a non-zero exit here is the command's answer, not a broken command. Do not report it as a tool failure and do not retry it.

- **Any `fail` or `cancel`** → stop. Name each failing check and its `link`. A rerun is the user's call.
- **Any `pending`** → wait, do not stop. This is the one place the skill blocks.
- **All `pass` / `skipping`** → go to step 5.
- **No checks at all** (`gh` says `no checks reported on the '{branch}' branch`) → go to step 5, and say so in the close block. "Nothing failed" and "nothing ran" read the same in a report and mean very different things.

### How to wait

```sh
gh pr checks {number} --watch --interval 30 --fail-fast
```

`--watch` returns when the checks finish, so a run of it bounded by whatever command timeout the agent allows is the whole wait. If the timeout cuts it off, re-run the same command — it picks the watch back up from the current state. `--fail-fast` returns as soon as one check fails, which is exactly when waiting longer stops being useful.

Two limits on the loop:

- **Say what you are waiting for between rounds** — which checks are still pending, and how long the wait has run. A silent skill and a hung skill look identical.
- **Give up after about 30 minutes of no state change** and report the checks still pending. A queue that never moves is an infrastructure problem, and sitting on it is not progress.

## Step 5. Merge

Nothing above stopped the run, so the PR is ready. Invoking this skill is the authorization to merge — do not ask again. Print one line naming the PR, the base branch and the method, then merge.

Take the method from the repository, not from a preference of your own:

```sh
gh api graphql -f query='query {
  repository(owner: "{owner}", name: "{repo}") {
    viewerDefaultMergeMethod
    squashMergeAllowed
    mergeCommitAllowed
    rebaseMergeAllowed
  }
}' --jq '.data.repository'
```

`viewerDefaultMergeMethod` is the method GitHub preselects on the merge button for this user in this repository — `MERGE`, `SQUASH` or `REBASE`. Use it. A skill that squashes a repository which keeps merge commits is imposing a house style nobody asked it for.

Two things bound that:

- **The user's own choice wins**, whenever they named a method with the invocation.
- **If the default is not among the allowed methods**, fall back to the first one that is, in the order squash, merge commit, rebase — and say which and why.

**This has to be the GraphQL query, not `gh api repos/{owner}/{repo}`.** The REST object's `allow_squash_merge`, `allow_merge_commit` and `allow_rebase_merge` come back as `null` for anyone without admin rights on the repository — the ordinary case of holding write access on a repository someone else administers — and it carries no default-method field at all. The GraphQL fields answer with read access alone.

```sh
gh pr merge {number} --{squash|merge|rebase} --match-head-commit {headRefOid}
```

**`--match-head-commit` is what makes the verified state and the merged state the same commit.** Everything checked so far was checked against one SHA; a push landing during step 4's wait moves the PR under the skill, and without the guard the merge quietly lands code no thread and no check in this pass ever saw. With it, GitHub refuses and the run stops.

So re-read the head **after** the checks pass and use that value:

```sh
gh pr view {number} --json headRefOid --jq '.headRefOid'
```

If it differs from the SHA the pass last recorded, the PR moved during the wait — say so and start the pass again from step 3 rather than merging: the new commits have their own threads and their own checks.

The base can move during the wait too. Read `mergeStateStatus` with the head (`--json headRefOid,mergeStateStatus`); if it is `BEHIND` again, [update the branch](#a-branch-that-is-behind-gets-updated) once more and go back to step 3. **Stop after the third update in one pass** and report it: a base that moves faster than the checks finish needs a merge queue, not a loop.

### If step 4 waited, the threads are stale too

A SHA guard only catches what a push changes, and a review thread is not one of those: a reviewer can open a blocking thread during the wait without touching a commit, and `--match-head-commit` would let that merge straight through. So **whenever step 4 actually waited**, run step 3's query again here, in the same breath as the head re-read, and treat a fresh unresolved thread exactly as step 3 does — stop, and hand it to `ali-process-pr-comments`.

When step 4 did not wait — the checks were already green on arrival — step 3 ran seconds ago and the query is not worth repeating.

**Leave branch deletion alone** — no `--delete-branch`. Whether the head branch goes is a repository setting, and `-d` deletes the local branch too, which is not undoable from here.

**A rejected merge ends the run as it stands.** Report `gh`'s message verbatim and stop; do not retry with another method, do not pass `--admin`, do not push anything.

### A merge command that returns is not always a merge

On a base branch with a **merge queue**, `gh pr merge` enqueues the PR or turns auto-merge on, and returns successfully having merged nothing yet. Confirm what actually happened before writing the close block:

```sh
gh pr view {number} --json state,mergedAt,mergeStateStatus
```

`state: MERGED` is the only thing that earns the merged verdict. Anything else — `OPEN` with auto-merge enabled, or queued — closes the pass as *queued, not merged*, and step 6 does not run: the base branch has nothing new to pull yet.

## Step 6. Switch the checkout to the base branch

Only after the PR actually reached `MERGED`. Where the session stands, as step 1 settled it, decides how.

### From the main checkout

Whatever branch it is on:

```sh
git checkout {baseRefName}
git pull --ff-only --prune
git rev-parse --short HEAD
```

`--ff-only` is not optional: if the local base branch has diverged from the remote, the pull stops instead of writing a merge commit onto it. Report that and stop — reconciling it is a separate decision, and the merge itself is already done either way. `--prune` drops the remote-tracking ref of the head branch when the repository deleted it on merge. The last command is the SHA the close block reports.

**A `git checkout` that fails leaves the pass merged but not switched.** Say exactly that — the merge is not in doubt, only the local checkout is. Never `--force` the switch, and never stash or discard anything to get past it: step 1's gate is what makes this case rare, and forcing it would spend the user's uncommitted work to tidy up a branch name.

A worktree of the PR, when it has one, is left where it is: the session never stood in it, and another session may. Name it with its removal command, `git worktree remove {path}`.

### From the PR's own worktree

The worktree has done its job; the main checkout may be another session's, so it is updated and never switched.

1. **Leave the worktree** — `ExitWorktree` with `keep`. A session that cannot leave — no worktree tools, or `ExitWorktree` reporting no worktree session because the session was started in this directory — prints the commands of items 2 and 3 for the user and closes with step 7's block, its `Now on` line saying the session is still in `{path}`.
2. **Remove it**, unless it holds a `.worktreeinclude` copy that differs from the main checkout's file — then keep it and say which file, since the worktree has the newer one. Without `{main}/.worktreeinclude` there is nothing to compare, and the first two commands are skipped:

   ```sh
   git -C {path} ls-files --others --ignored --exclude-from={main}/.worktreeinclude
   cmp -s {path}/{file} {main}/{file}
   git worktree remove {path}
   ```

   No `--force`: git refuses a dirty tree, which step 1's gate already ruled out, and initialized submodules — report that and leave the worktree. It deletes the worktree's ignored files without a word; that is the accepted price, and the README says so.
3. **Update the main checkout** — clean and on `{baseRefName}` → `git pull --ff-only --prune`; anything else → `git fetch origin {baseRefName} --prune`, leaving that branch and its work alone. The close block's SHA is then `git rev-parse --short {baseRefName}` after the pull, or `git rev-parse --short origin/{baseRefName}` after the fetch — the fetch moves only the remote-tracking ref, so the local branch would still name the commit from before the merge.

The head branch stays on disk either way. Report it by name so the user can delete it in one command if they want to. A fork's author chooses that name, so the command comes only when it starts with a letter or digit and holds nothing but letters, digits and `.` `_` `/` `-` `+` `@` `#` `%` `,` `=`; any other name is reported without one — pasted, its shell syntax would run.

## Step 7. Close the pass

Print this block, with nothing between it and the end of the run except what [step 8](#step-8-what-to-do-next) may add after it:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR #{number} — {title}
Checks: {n} passed{, waited {duration}} | or "none reported"
Threads: all resolved
{Branch: updated from {base}{, {n} times} — only when this pass updated it}

## ✅ MERGED ({method})
Now on {base} at {sha}. Local branch {head} kept — `git branch -d {head}` to drop it.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The `Now on` line follows step 6:

- **Run from the PR's worktree** → `Back in the main checkout, on {base} at {sha}` — or `, left on {branch}; origin/{base} fetched at {sha}, local {base} not moved` when it was busy — then `Worktree {path} removed.` or `Worktree {path} kept: {why}.`
- **Run from the main checkout while the PR has a worktree** → one more line: `Worktree {path} left — `git worktree remove {path}` to drop it.`

When something blocked it, the block is the same with the verdict replaced by the one blocker that stopped the run:

```
## 🛑 NOT MERGED — {blocker in three or four words}
{what is open, in one or two lines}
{one line: the next action — which skill, which command, or whose call it is}
```

When the PR was already merged before this pass started, the block carries no
`Checks:` and no `Threads:` line at all — this run verified neither — and the
verdict is:

```
## ✅ ALREADY MERGED
Merged before this pass started{, by {author}, on {mergedAt}}.
Now on {base} at {sha}. Local branch {head} kept — `git branch -d {head}` to drop it.
```

And when the merge went to a queue rather than to the base branch:

```
## ⏳ QUEUED — NOT MERGED YET
{one line: auto-merge enabled, or position in the merge queue}
Still on {head}; the base branch has nothing new to pull yet.
```

Rules for the close:

- **One blocker, not a list of everything wrong.** The run stops at the first one it hits; report that one and the checks it never got to reach.
- **Never merge past a blocker**, however small it looks. An unresolved thread on a typo is still unresolved.
- The block says what happened, not what might have. If the merge did not run, there is no SHA line.

## Step 8. What to do next

A landed PR leaves the user at a fork with no obvious next step on screen. This step puts one there — and only that. **It proposes, it does not start.** Do not open a branch, edit a file or pick up an issue off the back of it; the user's answer is what authorizes the next task.

Run it **only after a ✅ verdict** — `MERGED` or `ALREADY MERGED`. A 🛑 block already ends with the one next action that matters, and a ⏳ queued PR has not finished the current task, so neither gets a suggestion after it.

### The user's own open PRs come first

Before looking at anything else, ask whether the user has other pull requests still open here:

```sh
gh pr list --state open --author @me --limit 30 --json number,title,headRefName,headRepositoryOwner,isCrossRepository,isDraft,updatedAt
```

**Any result at all takes over this step.** An open PR of the user's own is work already written and waiting on them — it outranks every plan item and every issue, because starting something new while it sits there only widens the queue. So list them for the user to pick from — number, title, branch, `draft` where it applies, oldest first, since the one that has waited longest is usually the one to look at — and offer to open one of them for review.

Open it only once the user has picked one, and where depends on the state of the main checkout alone, wherever this run started — say which before opening:

- **The PR's local branch has a worktree** (step 1's naming rule, `git worktree list --porcelain`, prunable entries aside) → `ali-worktree` enters it. `gh pr checkout` would fail on a branch another worktree holds.
- **The main checkout is clean and on the base branch** → `gh pr checkout {number}` there, as after every ordinary run. Nothing of the user's rides on the branch being left.
- **Anything else** — uncommitted changes, or another branch, as after a run from the PR's worktree beside a busy main checkout, or one whose step-6 `git checkout` failed → `ali-worktree` opens the PR by its number in a worktree of its own, at the price of one approval, and leaves the main checkout alone.

If `gh pr checkout` fails in turn, report it as step 6 does and leave the checkout where it is.

**While any such PR is open, say nothing about the plan and nothing about the issues.** Do not run the queries below, do not mention them as a second option, do not append them under the PR list. They come back into play only when this listing is empty.

### Where the candidates come from — with no open PR of the user's left

Two sources, in this order:

- **The plan** — a plan the conversation is already working through, or a plan file this PR's branch, title or body points at (`docs/plan*.md`, `PLAN.md`, whatever the repository keeps). Read the plan and work out which of its items this PR just closed and which items are still open.
- **Open issues on the tracker**, when the repository has one:

  ```sh
  gh issue list --state open --limit 30 --json number,title,labels,updatedAt
  ```

  Drop what the merge just closed: a PR body with `Closes #12` takes `#12` off the list even if GitHub has not caught up yet.

**Look, do not dig.** One PR listing, one pass over the plan and one issue listing is the whole budget. This step is a pointer at the end of a merge, not a planning session — if neither source answers in that pass, treat it as empty and say nothing.

### What to print

Append after the close block, separated by a blank line, in the user's chat language:

- **The user has other open PRs** → that list, and nothing else. Offer to open one, and end the run there.
- **One obvious next item** — the plan's next unstarted item, or a single issue that plainly follows from what just merged. Name it in one line, with its issue number or plan item, and ask whether to start it.
- **No single obvious one** → offer **at most four** candidates drawn from both sources, ordered by what you would do first, each with a few words on why it earns that place. Say which one you would take, and let the user choose. Where the repository provides `ali-one-by-one`, or the user asks for such decisions in that format, ask in that format instead of a bare list.
- **The merge closed the last open plan item** → say the plan is done, and name it. Then the remaining open issues, if there are any, are the candidates; if there are none either, the plan being finished is the whole message.
- **No plan and no open issues** → print nothing at all. No "nothing to suggest", no empty heading. The close block is the end of the run.

Uncertainty is worth stating in a half-sentence — "the plan has no item for this, so these come from the tracker" — and never worth resolving by inventing an item. Suggest only what a source actually says.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Anything that reaches GitHub or git — always English.

## Extra context

If the user passed anything along with the invocation — a PR number, a merge method, a longer wait to allow — treat it as the scope of this pass. One thing it can never mean is skipping a check: the gates are the skill. It arrives below; an empty line there means no arguments were given, not that something went missing.

$ARGUMENTS
