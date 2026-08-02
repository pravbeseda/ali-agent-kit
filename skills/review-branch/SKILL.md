---
name: review-branch
description: Review the current branch against the repository's base branch and walk the user through the findings one at a time. Use when the user asks to "review the branch", "review my changes", "check this branch before the PR", or runs /ali-review-branch.
---

# Review Branch

Review every change on the current branch compared to the repository's base branch, then work through the findings interactively.

## Step 1. Collect the context

Resolve the base branch first — never assume `main`, and never diff against a local branch that may be weeks behind:

```sh
git fetch origin --quiet
git ls-remote --symref origin HEAD   # ref: refs/heads/master	HEAD
```

Read the default branch from the `ref:` line — `refs/heads/master` means the base is `master`, so `{base_ref}` is `origin/master`. This asks the remote directly, so it stays read-only and reports the branch the repository defaults to *now*; a local `refs/remotes/origin/HEAD` can be missing in a fresh clone, and a plain fetch never retargets it after the default branch is renamed.

If the command fails (no network, no such remote), fall back to the local ref — `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, which already prints a remote-qualified `origin/master`. Say that the answer comes from a possibly stale local ref. If that prints nothing either, ask the user which branch to compare against instead of guessing, and never run `git remote set-head` or any other command that writes to their repository.

With `{base_ref}` resolved — a remote-qualified ref, so never add a second `origin/`:

```sh
git rev-parse --abbrev-ref HEAD           # current branch
git diff {base_ref}...HEAD --name-status  # changed files
git diff {base_ref}...HEAD                # full diff
```

The three-dot form compares against the merge base, so commits that landed on the base branch after this one forked stay out of the review.

## Step 2. Review

1. Read each changed file **in full**, not only the diff — the surrounding code decides whether a change is correct.
2. Summarize the scope: what was added, modified, removed.
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
