---
name: review-pr
description: Review a pull request against one bar — does the change leave the codebase healthier than it found it — and post what fails it as inline comments through gh api, labelled blocking or suggestion, questions and doubts only, no fixes. Ends with a ready-to-merge verdict. Use when the user asks to "review the PR", "post a review on the PR", "leave comments on the PR", "comment on the PR as a reviewer", "is this PR ready to merge", or runs /ali-review-pr.
---

# Review PR

Answer one question about a pull request: **does this change leave the codebase healthier than it found it?** If it does, recommend the merge — a change does not have to be perfect to be ready. If it does not, publish the findings as inline comments on the exact line, through `gh api`, the way a human reviewer works: point at the problem or the doubt, do not fix the code and do not hand over a finished solution.

> **Not `ali-process-pr-comments`:** that skill triages existing threads and resolves them. This one posts NEW comments on the PR diff.
> **Not a summary review:** the findings are published together as one review, but each one is still its own inline comment anchored to a line. Do not collapse them into a single prose comment, and do not apply fixes.

## Step 1. PR context and what has already been decided

Fetch in parallel:

```sh
gh pr view --json number,headRefOid --jq '{number: .number, sha: .headRefOid}'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
gh pr diff {number}
```

`gh pr view` without an argument resolves the PR of the current branch. Pass the number explicitly (`gh pr view {number} --json ...`) when the user named one. If the command fails because the branch has no open PR, **stop**: say there is no PR to review and ask for a number — do not review the branch instead, that is `ali-review-branch`.

`headRefOid` — the SHA of the PR's latest commit — is required; without it GitHub rejects inline comments.

Then read the review history, **resolved threads included**:

```sh
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: {number}) {
      reviewThreads(first: 100) {
        nodes {
          isResolved
          path
          line
          raised: comments(first: 1) { nodes { body originalCommit { oid } } }
          outcome: comments(last: 1) { nodes { body } }
        }
      }
    }
  }
}'
```

Two things come out of it.

**The decision ledger.** Every thread is a finding that has already been weighed, and a resolved one that ends in "no, we are not doing this" is a decision, not an oversight. Do not raise it again. The single exception is a finding whose worth has visibly risen since — the code around it changed, or the case it predicted became reachable — and then the comment opens by saying what changed. Re-litigating a settled point is what turns a review into a treadmill, and the author cannot tell a fresh finding from a repeat one as cheaply as you can.

**Which round this is.** A thread whose opening comment starts with 🤖 is one of this skill's earlier findings. If any exists, this is a follow-up round and step 3 fixes its scope; the newest such thread carries `{reviewed_sha}` in its `originalCommit.oid` — the commit those findings were written against. If none exists, this is the first round and the whole diff is in scope. Both answers come from these threads and from nothing else: a finding posted on its own by the fallback in step 4 leaves a 🤖 thread but no review, so any second source would disagree with this one on exactly that path.

## Step 2. The bar a finding has to clear

A review is worth running only if it can make the change smaller, simpler or safer. Exactly two kinds of finding do that, and nothing else gets published.

**`blocking` — the change leaves the codebase worse than it found it.** One of:

- a wrong result, a crash or a lost error on an input you can name
- fragility: the code works only while some unstated condition holds, and nothing here holds it
- structure degraded: a responsibility placed where it does not belong, a seam broken, one decision now edited in two places
- complexity this change's own goal does not justify — a branch, a parameter, a layer, an option or a guard that nothing in the PR's purpose asks for

**`suggestion` — applying it removes code or removes a concept.** A guard for a case that cannot occur, an abstraction with one caller, a parameter no caller varies, a branch that cannot be taken, logic the diff already has elsewhere. A suggestion never holds up a merge; it is the author's call.

Two gates decide what survives:

- **Evidence.** Name the file, the line, and either the input or path where the code goes wrong today, or the code that would disappear. A finding that can only be phrased as "what if, one day" has no evidence and is not published — say it in the chat if it matters.
- **Growth.** If acting on the finding would make the code bigger, it must be `blocking`, or it is dropped. Hardening against a case nobody can reach is the single change that most reliably leaves a PR longer and more brittle than it was, and asking for it does more damage than the case ever would.

Not looked for at all: anything a linter or type checker catches, formatting, naming taste, and preferences with no consequence behind them.

**Forbidden:**

- proposing a fix, ready-made code, or a specific solution
- editing project files
- phrasing a finding as a verdict ("X must be done") — write it as a question or a doubt instead ("I am not sure case X is handled here — would that lead to Y?")

A comment must read like a human reviewer who is unsure and asks, not like a linter report or a task description for a fix.

## Step 3. A follow-up round reviews the fixes, nothing else

When step 1 found earlier 🤖 threads, this round has one narrow job: read only what has changed since the commit they were written against.

```sh
gh api repos/{owner}/{repo}/compare/{reviewed_sha}...{sha} --jq '.files[] | {filename, patch}'
```

If `reviewed_sha` equals `{sha}`, nothing has been pushed since the last review: there is nothing to verify, so publish nothing and say so.

Otherwise the round covers three things and stops:

1. **Each earlier finding: addressed or not addressed.** Attempted is not addressed. This is a report to the user in the chat, not new comments — those findings are already on the PR, and repeating them just doubles the thread.
2. **Defects the fixes introduced**, judged by the same bar as step 2. These are the only new inline comments a follow-up round may post.
3. **Everything else is out of scope.** Whatever you notice in code this pass did not touch goes to the user in the chat and stays off the PR. It was in scope for round 1 and was not worth a comment then; it does not get to extend the review now.

**The same disagreement twice is not a defect.** If a finding lands on code that was written to satisfy the previous round's finding, and it is the same objection in new clothes, publish nothing there. Put it to the user as a design disagreement to settle in one decision. Each round objecting to the answer the last round forced is the loop this scope exists to break, and it never resolves by running one more round.

## Step 4. Publish

**When nothing blocking came up, recheck before believing it.** Walk the files this round covered once more asking only the blocking question, and write one line per file naming the degradation or `none`. A bare "nothing found" without that line is a guess, and the recheck is cheap next to a merge recommendation that turns out wrong. Whatever it surfaces is an ordinary finding and goes out in the batch below — which is why it happens here and not after the review is sent, where it could only produce a second one.

**With nothing above the bar, publish nothing.** Not an empty review, not a summary-only one, not an approval — make no call at all. A review carrying a summary sentence and an empty `comments` array is a perfectly valid request, so nothing stops it but this rule, and once submitted it cannot be deleted, only dismissed. Go straight to step 5.

With findings — of either label — publish them straight away: no questions, no confirmations, and as **one** review, because a human reviewer leaves a single review, not eight loose comments. One call, so the author gets one notification and a half-published review is impossible.

**Write the request body to a file with the file-creation tool and pass it with `--input` — never build it inline in the shell.** Put the file in a temp dir, never in the working tree: this is the branch under review, and a stray file there shows up in `git status` and can be committed with the work. A heredoc or a long quoted argument makes the command multi-line, and the integrated terminal echoes such a command back with soft wrapping and `>` continuation prompts until the run looks hung, at which point nobody can tell whether the review was published. With a file the command is one short line whatever the findings say, and backticks, quotes, `$` and code blocks in a body never reach the shell at all.

```json
{
  "commit_id": "{sha}",
  "event": "COMMENT",
  "body": "🤖 {one line: what was reviewed, and how many blocking findings and suggestions follow}",
  "comments": [
    { "path": "{path}", "line": {line}, "side": "RIGHT", "body": "🤖 blocking: {the finding, in English}" }
  ]
}
```

Each comment body opens with its label — `blocking:` or `suggestion:` — right after the 🤖, so the author can tell at a glance what holds the merge and what does not.

```sh
gh api repos/{owner}/{repo}/pulls/{number}/reviews -X POST --input {file}
```

**Name the file by the literal absolute path it was written to — never `$TMPDIR`, `~` or any other shell variable.** The shell expands those in the terminal's environment, which is not the one the file-creation tool wrote in: `$TMPDIR` in an editor terminal commonly points somewhere else entirely, so the command names a file that does not exist and fails with `no such file or directory`. Give the file-creation tool an absolute path, then paste that same string into the command.

**Every body published by this skill opens with 🤖.** The summary and each finding alike, including the ones sent one at a time in the 422 fallback below. A reader who meets a single inline comment on a line should be able to tell at a glance that a machine wrote it, without having to find the review it belongs to. Nothing else is added — no name, no tool, no signature.

The top-level `body` is required by the API whenever `event` is `COMMENT` or `REQUEST_CHANGES` — without it the call fails with 422 before any line is even looked at. Keep it to a single sentence; the findings live in `comments`, not in the summary.

Use `"side": "LEFT"` for deleted lines. A comment can only be anchored to a line that appears in the diff — an added or context line on the RIGHT, a deleted line on the LEFT — and any other line is rejected with 422.

**On 422 the review was not created.** One line the API will not accept takes the whole batch down, and the error names the field rather than the entry at fault. If it does identify the finding (`line must be part of the diff`), drop that one and repost once — but if dropping it empties `comments`, post nothing at all and say so. If the repost fails too, or the offender is unknown, post the findings one at a time with `gh api repos/{owner}/{repo}/pulls/{number}/comments -X POST --input {file}` (`commit_id`, `path`, `line`, `side`, `body`, each body in its own file): a 201 is published for good and must never be resent, a 422 published nothing and that finding is skipped.

Do not reply to your own comments, do not resolve them, do not edit the code — publishing findings is the whole job.

## Step 5. The verdict

End every run with one verdict, and make it the last thing printed.

**Blocking findings stand** → not ready. Name them and stop; the next move is the author's.

**No blocking findings** → ready, and the recheck from step 4 is what says so.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{First round | Follow-up round} — {b} blocking, {s} suggestions, {x} dropped below the bar
Recheck: {one line per changed file, or "clean"}

## ✅ VERDICT: READY TO MERGE
{one or two sentences: what the change does for the codebase, and
which suggestions stay open — the author's call, not a condition}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When blocking findings stand, the block is the same with the recheck line dropped and the verdict replaced by:

```
## 🛑 VERDICT: NOT READY
{one or two sentences: which blocking findings stand in the way,
and which area they cluster in}
```

Rules for the verdict:

- Exactly one of the two lines, never both, never a hedged "maybe one more round".
- **Ready means the change leaves the codebase better than it found it — not that it is perfect.** There is no perfect code, only better code, and holding a PR for the difference costs more than it buys. Open `suggestion` threads never block a merge.
- A round that found only suggestions is a ready verdict. So is a round that found nothing.
- Never recommend "another full review". After the author acts, what is unreviewed is the fix, and that is step 3.
- Report a 422, a dropped finding or a one-at-a-time fallback only if it actually happened. Silence is the normal case.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Comments posted to the PR — always English.

## Extra context

If the user passed anything along with the invocation — a PR number, an area to focus on, a specific worry — treat it as the scope of the review. It arrives below; an empty line there means no arguments were given, not that something went missing.

$ARGUMENTS
