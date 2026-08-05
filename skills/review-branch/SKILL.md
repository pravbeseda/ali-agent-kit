---
name: review-branch
description: Review the current branch — committed, staged, unstaged and untracked changes — against the repository's base branch and walk the user through the findings one at a time. Use when the user asks to "review the branch", "review my changes", "check this branch before the PR", or runs /ali-review-branch.
---

# Review Branch

Review the working tree as it stands right now against the repository's base branch — committed, staged, unstaged and untracked work alike — then go through the findings interactively.

## Step 1. Collect the context

Resolve the base branch first — never assume `main`, and never diff against a local branch that may be weeks behind. The items below resolve `{base}`, the plain branch name, and nothing more; what to diff against is decided after that branch has been fetched.

**Set two variables on every block that reaches the remote:** `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes"`. Without them git blocks on a credentials prompt nobody will answer and the run reports nothing at all; with them it exits non-zero with a message the failure handling can act on. Appending to `GIT_SSH_COMMAND` rather than replacing it keeps a wrapper already in the environment. A fresh shell per tool call loses an `export`, so each remote-touching block below sets them again; local calls need neither.

**The base is what this branch merges into, which is not always the repository default.** A repository can default to `main` and still integrate everything through `develop` — diff such a branch against `main` and every `develop` commit it never touched shows up as a finding.

1. **If the branch has a pull request**, `baseRefName` is the answer, full stop:

   ```sh
   branch=$(git rev-parse --abbrev-ref HEAD)
   gh pr list --head "$branch" --state open --json baseRefName --jq '.[0].baseRefName // empty'
   ```

   The cases are separated by exit code, never by the wording of an error — the trap `gh pr view` sets, where "no PR" and a `401` both exit 1. A non-zero exit stops the pass, naming the error: a PR may well exist with a non-default base, and reviewing against the default there looks like an ordinary run. The one exception is `gh` missing or `origin` not being a GitHub remote — say so and carry on, since item 2 needs only `git`. Exit 0 with empty output is the ordinary "no PR", but `--head` matches on the branch name alone, so a branch pushed under a different name or a PR opened from a fork also lands here; if a PR was expected, say the name did not match instead of falling through to the default.
2. **If it has none**, fall back to the repository default, read-only:
   ```sh
   export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes"
   git ls-remote --symref origin HEAD   # ref: refs/heads/master	HEAD
   ```
   The `ref:` line names the default branch. Ask the remote rather than reading the local `refs/remotes/origin/HEAD`, which can be missing in a fresh clone and is never retargeted by a plain fetch after a rename.
3. **Check for an integration branch before settling for the default.** If `GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes" git ls-remote --heads origin develop` (or `release/*`, `staging`, whatever the repo uses) comes back non-empty **and names a branch other than the one item 2 resolved**, ask the user which of the two to review against.
4. **If nothing resolves** — `ls-remote` fails, say on a rate limit — fall back to the local `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, which prints `origin/master`; strip the prefix. If that prints nothing either, ask.

State in one line which base was chosen and why — a review against the wrong base is worse than no review. Beyond the fetch below, change nothing that outlives the pass: no `git remote set-head`, no config writes, no local branches, no working-tree changes. There is deliberately no general `git fetch origin` either: nothing downstream reads what it would refresh, and in a narrow clone it still could not create the ref the diff needs.

**Fetch the base branch by name, always, and diff from `FETCH_HEAD`:**

```sh
export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes"
git fetch origin {base} --quiet
```

Never check whether `origin/{base}` exists first and skip the fetch on that. A narrow clone either lacks the ref or holds a leftover that no fetch ever updates, so the check passes on exactly the stale ref and diffs against a month-old base — the silent wrong-base failure this whole step exists to prevent. Fetching by name is also the least invasive form: `FETCH_HEAD` moves and nothing else does, so a narrow clone stays narrow.

**This fetch is required, and a failed fetch ends the pass.** If it exits non-zero — no network, no such remote, credentials wanted — stop and say so; a diff against a week-old base invents findings and hides real ones.

```sh
git merge-base FETCH_HEAD HEAD                                   # empty output ends the pass
git rev-parse --abbrev-ref HEAD                                  # current branch
git diff "$(git merge-base FETCH_HEAD HEAD)" --name-status       # every changed file
git diff "$(git merge-base FETCH_HEAD HEAD)"                     # full diff
git status --short                                               # what is committed and what is not
git ls-files --others --exclude-standard --full-name -- :/       # untracked files, ignored ones left out
```

Diff from `FETCH_HEAD`, never from `origin/{base}` — that is precisely the ref that can be stale. The merge base is substituted inline rather than kept in a shell variable, for the same reason the environment variables are set in every block: a fresh shell per tool call would lose it.

**Run the bare `git merge-base` first, and stop the pass on empty output.** It prints nothing when the histories do not meet — a shallow clone, or a branch that really is unrelated — and the substitution in the lines below then collapses to `git diff ""`, whose complaint about an ambiguous argument says nothing about the base. Name the likely cause instead of running the rest.

Diffing from the merge base is what keeps commits that landed on the base branch after this one forked out of the review — the same thing `FETCH_HEAD...HEAD` does, and `git diff A...B` is defined as `git diff $(git merge-base A B) B`.

**Diff the merge base against the working tree, not against `HEAD`.** Naming a single commit and no second one makes git compare it with the files on disk, so committed, staged and unstaged changes all land in one diff, each hunk appearing exactly once. `FETCH_HEAD...HEAD` stops at the last commit, which silently drops everything not yet committed — and "nothing to report" on work in progress is the failure this skill is least able to notice. Do not add `git diff --cached` or a bare `git diff` on top: this one already contains both, and running them too reports the same hunk twice.

A tracked file can of course be dirty for something other than the branch — a debug `console.log`, a local config tweak. Say so when a hunk reads that way, but review it anyway: dropping it is the direction that loses findings.

Untracked files are the one gap, since no diff shows a file git does not know about. `git ls-files` needs both extra flags from a subdirectory: without `:/` it lists only what is under the current directory while every other command covers the repository, and `--full-name` prints repo-relative paths matching `git diff` instead of `../`-prefixed ones. Review the ones that are part of the work — a new source file, a new test, a new config — by reading them in full, and say in one line which untracked files you skipped as unrelated, so a forgotten `git add` surfaces instead of passing unnoticed.

`git status --short` is only for telling committed work apart from work that is not committed yet. Use it to label findings, never as a second source of changes — and never as a source of paths either: it prints them relative to the current directory.

## Step 2. Review

1. Read each changed file **in full**, not only the diff — the surrounding code decides whether a change is correct. This includes the untracked files kept in Step 1; for those the whole file is the change.
2. Summarize the scope: what was added, modified, removed. Mention how much of it is not committed yet — staged, unstaged, untracked — but review it all as one body of work, and do not split the findings by that.
3. Categorize every finding by severity:
   - **Critical** — bugs, security issues, data loss risks
   - **Warning** — missed edge cases, missing tests, convention violations (check the repo's CLAUDE.md / AGENTS.md)
   - **Suggestion** — duplication, possible simplifications, other improvements
4. Anchor every finding to `file_path:line_number`.

## Step 3. Interactive walkthrough

Print a short numbered summary — one line per finding with its severity tag — then immediately start on the first one.

Go one finding at a time, sorted critical → warning → suggestion:

- **Context** — what the code does now and why it is a problem (cite `file:line`)
- **Options** — the possible fixes, if there is more than one; for each, what changes and what it costs
- **Recommendation** — which option you would pick, and why

Wait for the user's decision before changing anything. After applying or skipping, move to the next finding automatically. If the user asks a question instead of choosing, answer it and re-present the options — never decide for them.

## Language

Conduct the review in the language the user writes in, or the chat language configured by the user, if one is defined.
