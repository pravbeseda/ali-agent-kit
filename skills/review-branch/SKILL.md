---
name: review-branch
description: Review the current branch against main and walk the user through the findings one at a time. Use when the user asks to "review the branch", "review my changes", "check this branch before the PR", or runs /ali-review-branch.
---

# Review Branch

Review every change on the current branch compared to `main`, then work through the findings interactively.

## Step 1. Collect the context

Run these first and base the review on their output:

```sh
git rev-parse --abbrev-ref HEAD        # current branch
git diff main...HEAD --name-status     # changed files
git diff main...HEAD                   # full diff
```

If the default branch is not `main`, use the repository's default branch instead.

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
