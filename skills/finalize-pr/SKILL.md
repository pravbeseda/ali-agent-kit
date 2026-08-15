---
name: finalize-pr
description: Land a pull request that is done — verify no unresolved review thread and no failing check, wait out the pending ones, merge, then switch the checkout to the base branch and pull. Use when the user asks to finish, land or merge a PR, or runs /ali-finalize-pr.
---

# Finalize PR

Land a pull request whose work is finished. The skill answers one question — **is there anything left that would make this merge premature?** — and acts on the answer: it merges when there is nothing, and it stops with a named blocker when there is.

> **Not `ali-review-pr`:** that skill judges the change and posts findings. This one assumes the judging is done and only checks that nothing is still open.
> **Not `ali-process-pr-comments`:** that skill triages review threads. This one refuses to merge while any thread is unresolved and hands them there.

**This skill fixes nothing.** It does not edit code, does not reply to comments, does not resolve threads and does not rerun a failed job. Every blocker it finds ends the run with a message naming what to do next.

## Step 1. Resolve the PR and the local state

Fetch in parallel:

```sh
gh pr view --json number,title,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName,url
gh repo view --json nameWithOwner --jq '.nameWithOwner'
git rev-parse --abbrev-ref HEAD
git status --porcelain
```

`gh pr view` without an argument resolves the PR of the current branch; pass the number explicitly when the user named one. If it fails because the branch has no open PR, **stop** and ask which PR to land.

Every field is used later: `title` and `number` in the close block, `headRefOid` as the merge guard in step 5, `baseRefName` in step 6.

**`state` is not `OPEN`** → stop. A `MERGED` PR is already done — say so and go straight to [step 6](#step-6-switch-the-checkout-to-the-base-branch), which is still worth running. A `CLOSED` one ends the pass.

### The working tree has to be clean

`git status --porcelain` is non-empty → **stop, before anything is merged**. Report the paths.

This applies whatever branch the checkout is on, for two different reasons:

- **On the PR's own branch** (`headRefName` equals the current branch) the dirt is work belonging to this PR that GitHub has never seen. Merging leaves it stranded on a branch nobody will look at again.
- **On any other branch** it is unrelated work that step 6 would drag onto the base branch, or that would make the `git checkout` fail outright.

When the checkout **is** the PR's branch, one more check, and it needs an upstream to answer:

```sh
git rev-list --count --left-right @{upstream}...HEAD
```

The right-hand number above zero means unpushed commits — commits the merge would exclude and then orphan. Report the count and stop.

The command exits `128` with `fatal: no upstream configured for branch '{name}'` when the branch has no tracking ref. That is not a failure of this step: no upstream means nothing was ever pushed from here, so compare against the PR's own head instead — `git rev-parse HEAD` against the `headRefOid` from above, and a mismatch stops the run the same way.

The whole gate sits here rather than in step 6 on purpose: a merge cannot be taken back, so the state that would make it wrong is checked while it still can be.

## Step 2. Blockers on the PR itself

Read the fields from step 1:

- **`isDraft` is true** → stop. A draft is not finished, whatever its checks say.
- **`reviewDecision` is `CHANGES_REQUESTED`** → stop, and name the reviewer.
- **`reviewDecision` is `REVIEW_REQUIRED`** → stop. The branch protection will refuse the merge anyway; saying so up front beats a failed `gh pr merge`.
- **`reviewDecision` is `APPROVED` or empty** → not a blocker. Empty means the repository asks for no review at all, which is a policy, not an omission — do not invent an approval requirement the repository does not have.
- **`mergeable` is `CONFLICTING`** → stop. The branch needs rebasing onto its base — the author's call, not this skill's.
- **`mergeStateStatus` is `BEHIND`** → stop and say the branch has to be updated first (`gh pr update-branch {number}` is the usual fix, but run it only if the user asks).
- **`mergeable` is `UNKNOWN`** → GitHub is still computing it. Re-read `gh pr view --json mergeable,mergeStateStatus` a few seconds later before deciding anything.

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

Pick the method from what the repository allows:

```sh
gh api repos/{owner}/{repo} --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge}'
```

Prefer squash, then merge commit, then rebase — unless the user named a method when invoking the skill, which always wins.

```sh
gh pr merge {number} --squash --match-head-commit {headRefOid}
```

**`--match-head-commit` is what makes the verified state and the merged state the same commit.** Everything checked so far was checked against one SHA; a push landing during step 4's wait moves the PR under the skill, and without the guard the merge quietly lands code no thread and no check in this pass ever saw. With it, GitHub refuses and the run stops.

So re-read the head **after** the checks pass and use that value:

```sh
gh pr view {number} --json headRefOid --jq '.headRefOid'
```

If it differs from the SHA step 1 read, the PR moved during the wait — say so and start the pass again from step 3 rather than merging: the new commits have their own threads and their own checks.

**Leave branch deletion alone** — no `--delete-branch`. Whether the head branch goes is a repository setting, and `-d` deletes the local branch too, which is not undoable from here.

**A rejected merge ends the run as it stands.** Report `gh`'s message verbatim and stop; do not retry with another method, do not pass `--admin`, do not push anything.

### A merge command that returns is not always a merge

On a base branch with a **merge queue**, `gh pr merge` enqueues the PR or turns auto-merge on, and returns successfully having merged nothing yet. Confirm what actually happened before writing the close block:

```sh
gh pr view {number} --json state,mergedAt,mergeStateStatus
```

`state: MERGED` is the only thing that earns the merged verdict. Anything else — `OPEN` with auto-merge enabled, or queued — closes the pass as *queued, not merged*, and step 6 does not run: the base branch has nothing new to pull yet.

## Step 6. Switch the checkout to the base branch

Only after the PR actually reached `MERGED`:

```sh
git checkout {baseRefName}
git pull --ff-only --prune
git rev-parse --short HEAD
```

`--ff-only` is not optional: if the local base branch has diverged from the remote, the pull stops instead of writing a merge commit onto it. Report that and stop — reconciling it is a separate decision, and the merge itself is already done either way. `--prune` drops the remote-tracking ref of the head branch when the repository deleted it on merge. The last command is the SHA the close block reports.

The head branch stays on disk. Report it by name so the user can delete it in one command if they want to.

**A `git checkout` that fails leaves the pass merged but not switched.** Say exactly that — the merge is not in doubt, only the local checkout is. Never `--force` the switch, and never stash or discard anything to get past it: step 1's gate is what makes this case rare, and forcing it would spend the user's uncommitted work to tidy up a branch name.

## Step 7. Close the pass

Print this as the last block, with nothing after it:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PR #{number} — {title}
Checks: {n} passed{, waited {duration}} | or "none reported"
Threads: all resolved

## ✅ MERGED ({method})
Now on {base} at {sha}. Local branch {head} kept — `git branch -d {head}` to drop it.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When something blocked it, the block is the same with the verdict replaced by the one blocker that stopped the run:

```
## 🛑 NOT MERGED — {blocker in three or four words}
{what is open, in one or two lines}
{one line: the next action — which skill, which command, or whose call it is}
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

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Anything that reaches GitHub or git — always English.

## Extra context

If the user passed anything along with the invocation — a PR number, a merge method, a longer wait to allow — treat it as the scope of this pass. One thing it can never mean is skipping a check: the gates are the skill. It arrives below; an empty line there means no arguments were given, not that something went missing.

$ARGUMENTS
