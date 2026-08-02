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
gh pr view --json baseRefName --jq '.baseRefName'   # the branch this work will actually merge into
```

**The base is what this branch merges into, which is not always the repository default.** A repository can default to `main` and still integrate everything through `develop` — diff such a branch against `main` and every `develop` commit it never touched shows up as a finding.

1. **If the branch has a pull request**, `baseRefName` is the answer, full stop: it is the branch the code will be merged into. It comes back as a plain branch name (`develop`), so `{base_ref}` is `origin/develop`.
2. **If it has none**, fall back to the repository default, read-only:
   ```sh
   git ls-remote --symref origin HEAD   # ref: refs/heads/master	HEAD
   ```
   The `ref:` line names the default branch — `refs/heads/master` means `{base_ref}` is `origin/master`. Asking the remote reports the branch the repository defaults to *now*; a local `refs/remotes/origin/HEAD` can be missing in a fresh clone, and a plain fetch never retargets it after a rename.
3. **Before settling for the default, check for an integration branch.** If `git ls-remote --heads origin develop` (or `release/*`, `staging`, whatever the repo uses) comes back non-empty, the repository has two plausible bases: ask the user which one to review against rather than assuming the default.
4. **If nothing resolves** — `ls-remote` fails offline, no remote — fall back to the local `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, which already prints a remote-qualified `origin/master`, and say the answer comes from a possibly stale local ref. If that prints nothing either, ask. Never run `git remote set-head` or any other command that writes to the user's repository.

Whatever the source, state in one line which base was chosen and why before showing findings — a review against the wrong base is worse than no review.

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
