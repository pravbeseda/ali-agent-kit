---
name: review-pr-duo
description: Review a pull request twice at once — Claude Opus and Codex, each in its own clean context — then work through everything they posted. Use when the user asks for a second opinion on a PR, a double review, or runs /ali-review-pr-duo.
agents: claude-code
disable-model-invocation: true
---

# Review PR twice

Run `ali-review-pr` twice over the same pull request, on two models that cannot
see each other's reasoning, wait for both, and hand what they published to
`ali-process-pr-comments`. This skill reviews nothing itself: it resolves the PR,
answers the one question the reviewers cannot be asked, dispatches them, and gets
out of the way.

> **Not `ali-review-pr`:** that skill is the review. This one runs two copies of it.
> **Manual only.** It spawns a process and publishes to a pull request, so it
> starts when the user asks for it and never on its own.

**Run it on pull requests you trust.** The Codex reviewer works unattended, with
the network open and this machine's `gh` credentials, over text somebody else
wrote — a diff, a description, existing comments. On a PR from a stranger's fork
that is content nobody has vetted driving an agent nobody is watching. Step 2
stops and asks before dispatching such a PR; `ali-review-pr` in your own session
is the answer that stays supervised.

## Step 1. Resolve the PR, and settle the one question for both

```sh
gh pr view --json number,headRefOid,headRefName,isCrossRepository --jq '{number: .number, sha: .headRefOid, branch: .headRefName, fork: .isCrossRepository}'
git rev-parse --abbrev-ref HEAD
git status --short
git rev-parse HEAD
```

`gh pr view` without an argument resolves the PR of the current branch; pass the
number explicitly when the user named one. **No PR, no run** — stop, and follow
`ali-review-pr` step 1's own rule about what to say.

**Then settle the checkout question here, before anything is dispatched.**
`ali-review-pr` step 1 stops and asks the user about a checkout that is not the
commit under review. Neither a subagent nor a `codex exec` process can hold that
conversation: one would guess, the other would sit there. So apply that skill's
rule against the output above, and where it says to ask, ask — in the shape it
defines, with the ways forward it offers — exactly once.

**If the user's answer is to stop and push first, the run ends here**; dispatching
anyway would review the state they just said not to review. Otherwise both dispatch
prompts below carry their answer verbatim: an answer settled here and not passed
down leaves each reviewer facing the question it was told not to ask.

## Step 2. Dispatch both reviewers

**A PR from a fork stops here for one question.** `fork` is true, so its branch,
its diff and its description were written by somebody outside this repository, and
the Codex side reads all three unsupervised with the network open. Say that, and
dispatch only if the user says to.

Both publish under the `gh` login of this machine, and each works in a context
that has never seen this conversation.

**Start the background Codex process first, then the Claude subagent — that order,
and no work in between.** A review published before the other reviewer has read the
PR's threads makes that second run a follow-up round with nothing new in it, which
`ali-review-pr` step 3 answers by publishing nothing at all. Both must have started
before either can publish.

**Background means the host's own background execution** — in Claude Code, the
shell tool's `run_in_background` — and not waiting on it here. Run that command in
the foreground and the Claude subagent is not dispatched until Codex has finished
and published, which is exactly the order this rule exists to prevent.

**Codex.** Write the prompt to a file exactly as `ali-review-pr` writes its own
request bodies — its rule for that file, temp dir and literal absolute path alike,
holds here unchanged — then:

```sh
codex exec - -s workspace-write -c sandbox_workspace_write.network_access=true < "{file}"
```

The prompt in that file: use the `$ali-review-pr` skill to review PR #{number},
the user's own scope if they gave one, the checkout answer from step 1, and one
line saying to ask nothing and to end with the verdict block.

**The prompt goes through a file, never on the command line.** The user's scope is
free text, and one apostrophe in it — `the parser's error paths` — closes the
quoting and hands the rest of the sentence to the shell.

**Call the file `codex-review-prompt.md`, and nothing derived from the PR.** The
path is the one thing still on that command line, and a branch name is the PR
author's to choose: `pr-$(...)` is a legal ref, and a file named after it puts a
command substitution back into the very command the file was meant to keep clean.
Quote it as above.

**The network flag is not optional.** Codex's `workspace-write` sandbox has no
network, and `ali-review-pr` publishes with `gh api` — without the flag the run
looks like a review that found nothing, and with it the process reaches the whole
network, which is what the fork question above is for. Model and reasoning effort
come from the user's `~/.codex/config.toml`; do not override them.

**If `codex` is not on the PATH**, say so in one line and run the Claude side
alone. One review is worth more than a stopped run.

**Claude.** The `Agent` tool, `model: "opus"`, told to invoke the `ali-review-pr`
skill on PR #{number}, carrying the same scope and the same checkout answer, to
ask nothing, and to return the verdict block it ends with.

Then say in one line which two reviewers are running, so the wait is not silent.

## Step 3. Wait for both

Do nothing while they work — no partial report, and above all no comment pass on
half the findings. When both are in, print the two verdicts side by side, each
labelled with the model that produced it, and nothing else: the findings are on
the PR, not in this summary.

**A verdict saying nothing was pushed since the last review is not always
agreement.** When both reviewers ran, the other verdict says which of its two
causes this is: both saying it means the head was already reviewed before this run
and nothing has been pushed since — they are right and the run had nothing to add
— while only one saying it means that one read the other's fresh comments as an
earlier round of its own and reviewed nothing. When one reviewer ran alone there is
no second review to have misread, so it is the first case. Say which, rather than
reporting it as a second opinion.

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
configured by the user, if one is defined.

## Extra context

If the user passed anything along with the invocation — a PR number, an area to
focus on — treat it as the scope and pass it to both reviewers unchanged. It
arrives below; an empty line there means no arguments were given.

$ARGUMENTS
