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
git symbolic-ref --quiet --short refs/remotes/origin/HEAD   # e.g. origin/master
```

If that prints nothing (a fresh or shallow clone often has no `origin/HEAD`), run `git remote set-head origin --auto` and try again; if it still fails, ask the user which branch to compare against instead of guessing.

Then, with `origin/{base}` from above:

```sh
git rev-parse --abbrev-ref HEAD               # current branch
git diff origin/{base}...HEAD --name-status   # changed files
git diff origin/{base}...HEAD                 # full diff
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

Conduct the review in the language the user writes in.
