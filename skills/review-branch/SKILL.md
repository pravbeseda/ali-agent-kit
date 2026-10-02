---
name: review-branch
description: Review the current local branch — committed, uncommitted and untracked work — against its base branch. Use when the user asks to review the branch or their local changes, to check the branch before a PR, or runs /ali-review-branch.
---

# Review Branch

Answer one question about the working tree as it stands right now — committed, staged, unstaged and untracked work alike — against the repository's base branch: **does this change leave the codebase healthier than it found it?** If it does, say the branch is ready — a change does not have to be perfect to be ready. If it does not, go through what fails that bar interactively, one finding at a time.

> **The same bar as `ali-review-pr`, a different channel.** That skill publishes its findings as inline comments on a pull request and touches nothing. This one has the author in front of it, so it presents options and applies the decision — but what counts as a finding at all is decided identically, so a branch that passes here does not collect a new set of objections the moment it becomes a PR.

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
3. **Check for an integration branch before settling for the default.** If `GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -oBatchMode=yes" git ls-remote --heads origin refs/heads/develop refs/heads/staging 'refs/heads/release/*'` comes back non-empty **and names a branch other than the one item 2 resolved**, list the branches it found and ask the user which of them — or the resolved default — to review against. The full `refs/heads/` patterns are deliberate: `ls-remote` matches bare patterns against the tail of the ref name, so a bare `develop` would also match `feat/develop`. If the probe comes back empty, fall through to the resolved default silently.
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
git log --format='%s%n%n%b' "$(git merge-base FETCH_HEAD HEAD)"..HEAD   # the branch's description
```

Diff from `FETCH_HEAD`, never from `origin/{base}` — that is precisely the ref that can be stale. The merge base is substituted inline rather than kept in a shell variable, for the same reason the environment variables are set in every block: a fresh shell per tool call would lose it.

**Run the bare `git merge-base` first, and stop the pass on empty output.** It prints nothing when the histories do not meet — a shallow clone, or a branch that really is unrelated — and the substitution in the lines below then collapses to `git diff ""`, whose complaint about an ambiguous argument says nothing about the base. Name the likely cause instead of running the rest.

Diffing from the merge base is what keeps commits that landed on the base branch after this one forked out of the review — the same thing `FETCH_HEAD...HEAD` does, and `git diff A...B` is defined as `git diff $(git merge-base A B) B`.

**Diff the merge base against the working tree, not against `HEAD`.** Naming a single commit and no second one makes git compare it with the files on disk, so committed, staged and unstaged changes all land in one diff, each hunk appearing exactly once. `FETCH_HEAD...HEAD` stops at the last commit, which silently drops everything not yet committed — and "nothing to report" on work in progress is the failure this skill is least able to notice. Do not add `git diff --cached` or a bare `git diff` on top: this one already contains both, and running them too reports the same hunk twice.

A tracked file can of course be dirty for something other than the branch — a debug `console.log`, a local config tweak. Say so when a hunk reads that way, but review it anyway: dropping it is the direction that loses findings.

Untracked files are the one gap, since no diff shows a file git does not know about. `git ls-files` needs both extra flags from a subdirectory: without `:/` it lists only what is under the current directory while every other command covers the repository, and `--full-name` prints repo-relative paths matching `git diff` instead of `../`-prefixed ones. Review the ones that are part of the work — a new source file, a new test, a new config — by reading them in full, and say in one line which untracked files you skipped as unrelated, so a forgotten `git add` surfaces instead of passing unnoticed.

`git status --short` is only for telling committed work apart from work that is not committed yet. Use it to label findings, never as a second source of changes — and never as a source of paths either: it prints them relative to the current directory.

The commit messages `git log` prints are the branch's own account of what it does — what step 2's claims check holds the code against, the way a review of a pull request holds it against the PR description.

## Step 2. The bar a finding has to clear

Read each changed file **in full**, not only the diff — the surrounding code decides whether a change is correct. This includes the untracked files kept in Step 1; for those the whole file is the change. Then summarize the scope: what was added, modified, removed. Mention how much of it is not committed yet — staged, unstaged, untracked — but review it all as one body of work, and do not split the findings by that.

A review is worth running only if it can make the change smaller, simpler or safer. Exactly two kinds of finding do that, and nothing else is raised.

**`blocking` — the change leaves the codebase worse than it found it.** One of:

- a wrong result, a crash or a lost error on an input you can name
- fragility: the code works only while some unstated condition holds, and nothing here holds it
- structure degraded: a responsibility placed where it does not belong, a seam broken, one decision now edited in two places
- complexity this change's own goal does not justify — a branch, a parameter, a layer, an option or a guard that nothing in the work's purpose asks for
- a rule the repository wrote down for itself is broken — read its CLAUDE.md / AGENTS.md, and the documents they link to, before ruling on this one

**`suggestion` — applying it removes code or removes a concept.** A guard for a case that cannot occur, an abstraction with one caller, a parameter no caller varies, a branch that cannot be taken, logic the branch already has elsewhere. A suggestion never holds the work back; it is the author's call.

**Assertions in a new test that cannot fail.** Two shapes, and both are `suggestion`:

- **The asserted value never passes through the subject.** It is read straight back off the stub, or a fixture constant is checked against itself, so the line stands or falls with the test's own setup and no change to the code under test can make it fail. A stubbed value returned *through* the subject is not this case: a subject that starts discarding, filtering or transforming it breaks that expectation, which is the test doing its job.
- **The subject belongs to somebody else.** The assertion is about what a library, a framework or another component does, not about this change. That component has its own tests, and this one now fails when it is upgraded, in a file whose name points at the wrong code.

Look for both only in the tests this change adds or rewrites — an existing test is not this change's to prune. And do not mistake a working assertion for one of these: checking that the code under test called a mock with the right arguments is the test doing its job. Where a shallow assertion is the only thing standing in for a path nobody exercises, the untested path is its own finding and is judged by the bar above like any other.

**Structure is read past the hunk.** A broken seam has no failing input and often no wrong line in the diff, so look for it on purpose:

- **Ownership.** Does a module now encode another module's internal decision — how it stores, caches or retries its data, how it handles its errors, when it starts and stops? Would the next change inside that module force an edit here?
- **Contracts.** Where a public or cross-module interface widened, does each new member mean the same whatever state the provider is in internally, does it match the style of the rest of the interface, and is every copy or declaration of the contract kept in step?
- **Critical paths.** Against the code before the change: does something that was synchronous or independent now wait on I/O or on another module, and does a part of the result that does not need the new dependency wait for it anyway?
- **Callees.** Follow each new call into another module far enough to see what it does, even where that code is outside the diff: global state mutated on every call, a remote request repeated by an unrelated reactive source.
- **Callers.** Where the cost, timing, side effects or failure modes of an existing function changed — a synchronous read that now waits on I/O, a new remote request, a new way to fail — list its callers outside the diff and check each, hot paths first: loops, per-item and per-keystroke paths, background work. A finding names the caller and what it now does.
- **Claims.** Do the change's own description, comments and metrics say what the code actually does?
- **Purpose.** Read what the change says it is for — its own description, a linked ticket. Does any path in the code work against that purpose?

Judge all of it against general clean-architecture principles and against the rules the repository documents for itself — CLAUDE.md, AGENTS.md, CONTRIBUTING, architecture docs, and the documents those files link to, one level deep, a review checklist among them — read before this pass, not only before ruling on a broken rule. A rule written in a linked document counts the same as one written in AGENTS.md itself. Design documents the change itself adds or edits state the author's intent: they are under review, not the yardstick. A design decision is a valid subject for a finding whether it is documented or not, and "as designed" settles nothing.

Two gates decide what survives:

- **Evidence.** Name the file, the line, and either the input or path where the code goes wrong today, or the code that would disappear. A finding that can only be phrased as "what if, one day" has no evidence and is not raised as a finding — mention it in one line if it matters at all. A structural finding has its evidence when it names both locations — the code that now holds the decision and the module the decision belongs to — and the concrete next change that would have to edit both. "One day" excludes speculative inputs and unreachable cases, not a seam that is already broken.
- **Growth.** If acting on the finding would make the code bigger, it must be `blocking`, or it is dropped. Hardening against a case nobody can reach is the single change that most reliably leaves the work longer and more brittle than it was, and asking for it does more damage than the case ever would. Restoring a broken boundary often does add code, and a `blocking` structural finding passes this gate like any other blocking one.

Not looked for at all: anything a linter or type checker catches, formatting, naming taste, and preferences with no consequence behind them.

Anchor every finding to `file_path:line_number`, and label it `blocking` or `suggestion`.

**When nothing blocking came up, recheck before believing it.** Walk the changed files once more asking only the blocking question, and write one line per file naming the degradation or `none`. A bare "nothing found" without that line is a guess, and the recheck is cheap next to telling the author the branch is ready. Whatever it surfaces is an ordinary finding and joins the walkthrough below — which is why it happens here and not after the walkthrough, where it could only reopen one that is already finished.

## Step 3. Interactive walkthrough

Print a short numbered summary — one line per finding with its label — then immediately start on the first one.

Go one finding at a time, `blocking` first, then `suggestion`:

- **Context** — what the code does now and why it is a problem (cite `file:line`)
- **Options** — the possible fixes, if there is more than one; for each, what changes and what it costs
- **Recommendation** — which option you would pick, and why

Wait for the user's decision before changing anything. After applying or skipping, move to the next finding automatically. If the user asks a question instead of choosing, answer it and re-present the options — never decide for them.

## Step 4. The verdict

End every run with one verdict, once every finding has been applied or skipped, and make it the last thing printed.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{b} blocking, {s} suggestions, {x} dropped below the bar
Recheck: {one line per changed file, or "clean"}

## ✅ VERDICT: READY FOR A PR
{one or two sentences: what the change does for the codebase, and
which suggestions the author left open — their call, not a condition}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When blocking findings are still standing — because the user chose to skip them — the block is the same with the recheck line dropped and the verdict replaced by:

```
## 🛑 VERDICT: NOT READY
{one or two sentences: which blocking findings stand in the way,
and which area they cluster in}
```

Rules for the verdict:

- Exactly one of the two lines, never both, never a hedged "maybe one more pass".
- **Ready means the change leaves the codebase better than it found it — not that it is perfect.** Open suggestions never hold the work back.
- A pass that found only suggestions is a ready verdict. So is a pass that found nothing.
- A blocking finding the user skipped is still blocking. Fixing one during the walkthrough clears it.
- Say in one line what is still uncommitted or untracked, so nothing is left behind when the PR is opened. It does not change the verdict.

## Language

Conduct the review in the language the user writes in, or the chat language configured by the user, if one is defined.
