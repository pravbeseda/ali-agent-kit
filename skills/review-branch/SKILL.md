---
name: review-branch
description: Review the current branch against the repository's base branch and walk the user through the findings one at a time. Use when the user asks to "review the branch", "review my changes", "check this branch before the PR", or runs /ali-review-branch.
---

# Review Branch

Review every change on the current branch compared to the repository's base branch, then work through the findings interactively.

## Step 1. Collect the context

Resolve the base branch first — never assume `main`, and never diff against a local branch that may be weeks behind:

```sh
branch=$(git rev-parse --abbrev-ref HEAD)
gh pr list --head "$branch" --state open --json baseRefName --jq '.[0].baseRefName // empty'   # the branch this work will actually merge into
```

There is deliberately no general `git fetch origin` here. Nothing downstream would read what it refreshes: the base is resolved through `gh pr list` and `git ls-remote`, which go to the remote themselves, and the diff runs from the `FETCH_HEAD` of the one fetch that does matter — `git fetch origin {base}`, below. A blanket fetch would pull every branch so that nobody reads the result, and in a narrow clone it still could not create the ref the diff needs.

Every `git` call in this skill that reaches the remote — the `ls-remote` and `fetch` calls below — must run with two environment variables set: `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes"`. Without them git asks for a username or a key passphrase and waits, so an unattended run hangs on a prompt nobody will answer and never reports anything at all — an instruction to "treat a prompt as a failure" cannot help, because there is no message to act on. With them set, git returns non-zero immediately (`could not read Username`) and the failure handling can do its job.

`GIT_SSH_COMMAND` appends `-oBatchMode=yes` to an existing value rather than replacing it, so a custom SSH wrapper or identity already in the environment survives — only the batch flag is added on top. A `~/.ssh/config` identity or proxy is untouched either way, since plain `ssh` reads it. (A wrapper set only through git's `core.sshCommand` config is the one case this does not preserve.)

They do not carry across commands on their own: every tool call starts a fresh shell, so an `export` in one block is gone by the next. That is why each remote-touching block below sets them itself rather than once at the top. The local git calls — `symbolic-ref`, `rev-parse`, `git diff` against `FETCH_HEAD` — never reach the network and need neither.

**The base is what this branch merges into, which is not always the repository default.** A repository can default to `main` and still integrate everything through `develop` — diff such a branch against `main` and every `develop` commit it never touched shows up as a finding.

These four items resolve `{base}`, the plain branch name, and nothing more. What to diff against is decided once, below, after that branch has been fetched — never here.

1. **If the branch has a pull request**, `baseRefName` is the answer, full stop: it is the branch the code will be merged into, and it comes back as the plain name `develop`.

   `gh pr list` separates the cases by exit code, not by the wording of an error message — "no PR" is a successful empty result here, never a failure, so a reworded error string can never be taken for it (the trap `gh pr view` sets, where the absence of a PR and a `401` both exit 1):

   - **Exit 0, a branch name printed** — a pull request exists; that name is the answer, full stop.
   - **Exit 0, empty output** — no pull request whose head branch is named `$branch`. Usually that just means no PR, the ordinary case: continue with item 2. But `--head` matches on the branch name alone, so a branch pushed to the remote under a different name, or a PR opened from a fork (head `owner:branch`), also resolves to empty here even though a PR exists — and falling through to the default base is the silent wrong-base outcome this step exists to prevent. If a PR was expected, say the branch name did not match rather than assuming none exists, and let the user name the base or the PR.
   - **`gh` is missing (command not found), or `origin` is not a GitHub remote** — the command cannot run at all, so there can be no pull request to find. Say so in one line and continue with item 2; item 2 reads the remote through `git` and does not need `gh`.
   - **Any other non-zero exit** — `HTTP 401: Bad credentials`, a network error, an API error. Stop, exactly as a failed fetch does. A pull request may well exist with a base that is not the default, and reviewing against the default here produces a diff full of commits the branch never touched while looking like an ordinary run. Say which error came back, so the user can fix it or name the base themselves.
2. **If it has none**, fall back to the repository default, read-only:
   ```sh
   export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes"
   git ls-remote --symref origin HEAD   # ref: refs/heads/master	HEAD
   ```
   The `ref:` line names the default branch — `refs/heads/master` means `{base}` is `master`. Asking the remote reports the branch the repository defaults to *now*; a local `refs/remotes/origin/HEAD` can be missing in a fresh clone, and a plain fetch never retargets it after a rename.
3. **Before settling for the default, check for an integration branch.** If `GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes" git ls-remote --heads origin develop` (or `release/*`, `staging`, whatever the repo uses) comes back non-empty **and names a branch other than the `{base}` item 2 just resolved**, the repository has two plausible bases: ask the user which one to review against rather than assuming the default. When the candidate is the branch already chosen — a repository whose default *is* `develop` — there is nothing to choose between, so ask nothing and carry on.
4. **If nothing resolves** — `ls-remote` fails, say on a rate limit — fall back to the local `git symbolic-ref --quiet --short refs/remotes/origin/HEAD`, which prints `origin/master`; strip the `origin/` to get `{base}`, and say which branch it names. If that prints nothing either, ask. Beyond the fetch above, change nothing that outlives the pass: never run `git remote set-head`, never write to the config, never touch local branches or the working tree.

Whatever the source, state in one line which base was chosen and why before showing findings — a review against the wrong base is worse than no review.

**Fetch the base branch by name, always, and diff from `FETCH_HEAD`:**

```sh
export GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes"
git fetch origin {base} --quiet   # non-interactive via the vars above; {base_ref} is then FETCH_HEAD
```

Do this unconditionally rather than checking whether `origin/{base}` exists first. A `--single-branch` or otherwise narrow clone has a fetch refspec covering one branch, so no plain `git fetch origin` would ever create `origin/develop` — and worse, a stale `origin/develop` left over from an earlier refspec or a one-off manual fetch stays in the clone forever without ever being updated. An existence check passes on exactly that ref and diffs against a month-old base, which is the same silent wrong-base failure this whole step exists to prevent, and silent is worse than broken.

Fetching by name is also the least invasive form: it leaves `FETCH_HEAD` pointing at the branch without adding a remote-tracking ref the user never had, and a narrow clone is usually narrow on purpose. Nothing that outlives the pass changes — not the config, not local branches, not `origin/HEAD`, not the working tree. That is the line the read-only rule in item 4 draws.

**This fetch is required, and a failed fetch ends the pass.** If it exits non-zero — no network, no such remote, credentials wanted — stop and say so; do not review against whatever the clone happens to hold. A diff against a week-old base invents findings and hides real ones, which is worse than no review.

`{base_ref}` is `FETCH_HEAD`, and this is the only place it is defined — never `origin/{base}`, which is precisely the ref that can be stale:

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
