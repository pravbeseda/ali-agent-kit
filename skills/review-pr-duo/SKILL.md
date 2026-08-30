---
name: review-pr-duo
description: Review a pull request twice at once — Claude Opus and Codex, each in its own clean context — then work through everything they posted. Use when the user asks for a second opinion on a PR, a double review, or runs /ali-review-pr-duo.
agents: claude-code
disable-model-invocation: true
---

# Review PR twice

Run `ali-review-pr` twice over the same pull request, on two different models that
cannot see each other's reasoning, wait for both, and hand what they published to
`ali-process-pr-comments`. This skill reviews nothing itself: it resolves the PR,
answers the one question the reviewers cannot ask, dispatches them, and gets out
of the way.

> **Not `ali-review-pr`:** that skill is the review. This one runs two copies of it.
> **Manual only.** It spawns processes and publishes to a pull request, so it
> starts when the user asks for it and never on its own.

## Step 1. Resolve the PR, and settle the question the reviewers cannot ask

```sh
gh pr view --json number,headRefOid,headRefName --jq '{number: .number, sha: .headRefOid, branch: .headRefName}'
git rev-parse --abbrev-ref HEAD
git status --short
git rev-parse HEAD
```

`gh pr view` without an argument resolves the PR of the current branch; pass the
number explicitly when the user named one. **No PR, no run** — say so and ask for
a number rather than reviewing the branch, which is `ali-review-branch`.

**Then settle the checkout question here, before anything is dispatched.**
`ali-review-pr` step 1 stops and asks the user when the checkout is the PR's own
branch and holds work the PR does not — uncommitted paths, or a `HEAD` that
differs from `headRefOid`. Neither a subagent nor a `codex exec` process can hold
that conversation: one would guess, the other would sit there. So ask it yourself,
exactly once, and pass the answer down to both.

Ask only when the current branch **is** `headRefName` and either check comes back
dirty. Otherwise the local state has nothing to do with the PR — dispatch straight
away.

## Step 2. Dispatch both reviewers

Both run at the same time, in a context that has never seen this conversation, and
both publish under the `gh` login of this machine.

**Claude.** The `Agent` tool, `model: "opus"`, told to invoke the `ali-review-pr`
skill on the PR by number, to ask nothing, and to return the verdict block it ends
with.

**Codex.** In the background, from the repository root:

```sh
codex exec 'Use $ali-review-pr to review PR #{number}. Ask nothing: if something is ambiguous, review the pushed state and say so at the end.' -s workspace-write -c sandbox_workspace_write.network_access=true
```

**Single quotes, always.** `$ali-review-pr` is how Codex names a skill, and a
double-quoted string hands that to the shell instead, which expands it to nothing
and asks Codex to review a PR with no instructions at all.

**The network flag is not optional.** Codex's `workspace-write` sandbox has no
network, and `ali-review-pr` publishes its findings with `gh api` — without the
flag the run looks like a review that simply found nothing.

Model and reasoning effort come from the user's `~/.codex/config.toml`; do not
override them.

**If `codex` is not on the PATH**, say so in one line and run the Claude side
alone. One review is worth more than a stopped run.

## Step 3. Wait for both

Do nothing while they work — no partial report, and above all no comment pass on
half the findings. When both are in, print the two verdicts side by side, each
labelled with the model that produced it, and nothing else: the findings are on
the PR, not in this summary.

If one of them failed — a non-zero exit, a subagent that came back empty — say
which one and what it said, and carry on with the other's findings.

## Step 4. Hand over to `ali-process-pr-comments`

Run it straight away, and tell it one thing it cannot work out on its own: **two
independent reviews ran against the same commit, so the same line may carry two
🤖 comments that say the same thing.** Its own rule for several comments about one
topic applies — one decision, both threads.

Nothing else is passed down. The comment pass decides each finding on its merits,
as it always does, and it is the only thing in this run that edits code.

## Language

Conduct the run in the language the user writes in, or the chat language
configured by the user, if one is defined. Everything published to the PR is
English, which is `ali-review-pr`'s own rule and not this skill's to change.

## Extra context

If the user passed anything along with the invocation — a PR number, an area to
focus on — treat it as the scope and pass it to both reviewers unchanged. It
arrives below; an empty line there means no arguments were given.

$ARGUMENTS
