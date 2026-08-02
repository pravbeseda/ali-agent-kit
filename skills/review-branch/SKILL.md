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

**The fetch is required, and a failed fetch ends the pass.** If it exits non-zero — no network, no such remote, credentials wanted — stop and say so; do not review against whatever the clone happens to hold. A diff against a week-old base invents findings and hides real ones, which is worse than no review. Treat a credential prompt as a failure rather than waiting on it.

This is the one command here that writes anything, and what it writes is bounded: new objects, `FETCH_HEAD` and the `refs/remotes/origin/*` refs. Nothing that outlives the pass changes — not the config, not local branches, not `origin/HEAD`, not the working tree. That is the line the read-only rule in item 4 draws.

**The base is what this branch merges into, which is not always the repository default.** A repository can default to `main` and still integrate everything through `develop` — diff such a branch against `main` and every `develop` commit it never touched shows up as a finding.

1. **If the branch has a pull request**, `baseRefName` is the answer, full stop: it is the branch the code will be merged into. It comes back as a plain branch name (`develop`), so `{base_ref}` is `origin/develop`.

   `gh pr view` exits non-zero for reasons that are not interchangeable, so read the message before deciding what it meant:

   - **No pull request for this branch** — the ordinary case. Continue with item 2.
   - **`gh` is missing, or `origin` is not GitHub at all** — there can be no pull request to find. Say so in one line and continue with item 2.
   - **Anything else** — `HTTP 401: Bad credentials`, a network error, an API error. Stop, exactly as a failed fetch does. A pull request may well exist with a base that is not the default, and reviewing against the default here produces a diff full of commits the branch never touched while looking like an ordinary run. Say which error came back, so the user can fix it or name the base themselves.
2. **If it has none**, fall back to the repository default, read-only:
   ```sh
   git ls-remote --symref origin HEAD   # ref: refs/heads/master	HEAD
   ```
   The `ref:` line names the default branch — `refs/heads/master` means `{base_ref}` is `origin/master`. Asking the remote reports the branch the repository defaults to *now*; a local `refs/remotes/origin/HEAD` can be missing in a fresh clone, and a plain fetch never retargets it after a rename.
3. **Before settling for the default, check for an integration branch.** If `git ls-remote --heads origin develop` (or `release/*`, `staging`, whatever the repo uses) comes back non-empty, the repository has two plausible bases: ask the user which one to review against rather than assuming the default.
4. **If nothing resolves** — `ls-remote` fails even though the fetch went through, say on a rate limit — fall back to the local `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, which already prints a remote-qualified `origin/master`, and say which branch it names. If that prints nothing either, ask. Beyond the fetch above, change nothing that outlives the pass: never run `git remote set-head`, never write to the config, never touch local branches or the working tree.

Whatever the source, state in one line which base was chosen and why before showing findings — a review against the wrong base is worse than no review.

**Fetch the base branch by name, always, and diff from `FETCH_HEAD`:**

```sh
git fetch origin {base} --quiet   # {base} is the plain branch name; then {base_ref} is FETCH_HEAD
```

Do this unconditionally rather than checking whether `origin/{base}` exists first. A `--single-branch` or otherwise narrow clone has a fetch refspec covering one branch, so the generic `git fetch origin` above never creates `origin/develop` — and worse, a stale `origin/develop` left over from an earlier refspec or a one-off manual fetch stays in the clone forever without ever being updated. An existence check passes on exactly that ref and diffs against a month-old base, which is the same silent wrong-base failure this whole step exists to prevent, and silent is worse than broken.

Fetching by name is also the least invasive form: it leaves `FETCH_HEAD` pointing at the branch without adding a remote-tracking ref the user never had, and a narrow clone is usually narrow on purpose. If this fetch fails, stop, as with any other failed fetch.

With `{base_ref}` resolved — `FETCH_HEAD`, or a remote-qualified ref if one is used instead, so never add a second `origin/`:

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
