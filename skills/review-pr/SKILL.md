---
name: review-pr
description: Review a pull request and post the findings as inline comments on the code through gh api, the way a human reviewer does — questions and doubts only, no fixes and no ready-made solutions. Use when the user asks to "review the PR", "post a review on the PR", "leave comments on the PR", "comment on the PR as a reviewer", or runs /ali-review-pr.
---

# Review PR

Review the changes in a pull request and publish each finding as an inline comment on the exact line, through `gh api` — the way a human reviewer works: point at the problem or the doubt, do not fix the code and do not hand over a finished solution.

> **Not `ali-process-pr-comments`:** that skill triages existing threads and resolves them. This one posts NEW comments on the PR diff.
> **Not a summary review:** the findings are published together as one review, but each one is still its own inline comment anchored to a line. Do not collapse them into a single prose comment, and do not apply fixes.

## Step 1. PR context

Fetch in parallel:

```sh
gh pr view --json number,headRefOid --jq '{number: .number, sha: .headRefOid}'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
gh pr diff {number}
```

`gh pr view` without an argument resolves the PR of the current branch. Pass the number explicitly (`gh pr view {number} --json ...`) when the user named one. If the command fails because the branch has no open PR, **stop**: say there is no PR to review and ask for a number — do not review the branch instead, that is `ali-review-branch`.

`headRefOid` — the SHA of the PR's latest commit — is required; without it GitHub rejects inline comments.

## Step 2. Analyze the diff

Look only for:

- outright bugs and incorrect logic
- risky assumptions and edge cases that raise a real doubt
- suspicious deviations from the patterns already in the codebase

Do not look for: nits a linter or type checker would catch, pure style, subjective preferences with no real risk.

**Forbidden:**

- proposing a fix, ready-made code, or a specific solution
- editing project files
- phrasing a finding as a verdict ("X must be done") — write it as a question or a doubt instead ("I am not sure case X is handled here — would that lead to Y?")

A comment must read like a human reviewer who is unsure and asks, not like a linter report or a task description for a fix.

A finding can only be attached to a line that actually appears in the diff — an added or context line on the RIGHT side, or a deleted line on the LEFT — otherwise the GitHub API returns 422.

## Step 3. Publish

**With no findings, publish nothing.** Not an empty review, not a summary-only one, not an approval — make no call at all, and tell the user in the chat what was reviewed and why it came back clean. A review carrying a summary sentence and an empty `comments` array is now a perfectly valid request, so nothing stops it but this rule, and once submitted it cannot be deleted, only dismissed. Deciding the PR is fine is the user's call to make, not a by-product of finding nothing.

With findings: no questions, no confirmations — publish them straight away, as **one** review, because a human reviewer leaves a single review, not eight loose comments. One call, so the author gets one notification and a half-published review is impossible:

```sh
gh api repos/{owner}/{repo}/pulls/{number}/reviews -X POST --input - <<'JSON'
{
  "commit_id": "{sha}",
  "event": "COMMENT",
  "body": "🤖 {one line naming what was reviewed and how many questions follow}",
  "comments": [
    { "path": "{path}", "line": {line}, "side": "RIGHT", "body": "🤖 {the finding, in English}" }
  ]
}
JSON
```

**Every body published by this skill opens with 🤖.** The summary and each finding alike, including the ones sent one at a time in the 422 fallback below. A reader who meets a single inline comment on a line should be able to tell at a glance that a machine wrote it, without having to find the review it belongs to. Nothing else is added — no name, no tool, no signature.

The top-level `body` is required by the API whenever `event` is `COMMENT` or `REQUEST_CHANGES` — without it the call fails with 422 before any line is even looked at. Keep it to a single sentence; the findings live in `comments`, not in the summary.

Use `"side": "LEFT"` for deleted lines. Write the JSON to a file and pass `--input {file}` instead when a finding's body contains characters that would be awkward inside a heredoc.

**On 422** — one line the API will not accept takes the whole batch down with it. The error body names the resource and the field (`line must be part of the diff`), not which entry in `comments` is at fault, so it usually cannot be used to pick the offender out of the batch.

**Take a snapshot of the existing reviews before publishing.** A 422 is expected to leave nothing behind, but that is an observation, not a documented guarantee, and acting on it blindly is how every finding gets published twice — the exact outcome the single-review rule exists to prevent.

```sh
# before the POST
gh api --paginate repos/{owner}/{repo}/pulls/{number}/reviews --jq '.[].id' | sort > {before}
# after a 422
gh api --paginate repos/{owner}/{repo}/pulls/{number}/reviews --jq '.[].id' | sort | comm -13 {before} -
```

`--paginate` matters: the endpoint returns 30 per page, and a review created beyond the first page would otherwise look like nothing landed and be published a second time.

**A new id is a candidate, not an answer.** Anything submitted while the POST was in flight — a human reviewer, a bot, another run of this skill — also shows up in that difference, and mistaking it for this call means silently dropping every finding. Confirm a candidate before believing it:

```sh
gh api user --jq '.login'                                        # who this token is
gh api repos/{owner}/{repo}/pulls/{number}/reviews/{id} --jq '{user: .user.login, commit_id}'
gh api repos/{owner}/{repo}/pulls/{number}/reviews/{id}/comments --jq '.[] | {path, line, body}'
```

A candidate is this call only if the author is the authenticated login, `commit_id` is `{sha}`, **and** its comments are the findings from the batch. Author and commit alone are circumstantial — an earlier run of this skill under the same token matches both — so the comments decide. If no candidate qualifies, nothing of ours landed.

Then recover:

1. **A candidate is confirmed — this review did land** — treat it as published. Do not repost the batch. Compare its comments with the findings and post only those absent from it, one at a time, as in item 3; that same read is what makes "missing" a decidable question rather than a guess.
2. **No candidate qualifies and the message identifies the finding** — drop that one and repost the batch, **once**. If that repost also fails, stop reposting and go to item 3; retrying line by line burns a round trip per bad line and can loop as long as bad lines remain.

   Two things to get right before reposting. If dropping the finding leaves `comments` empty, **post nothing at all** — that request would create exactly the summary-only review the top of this step forbids, and a submitted review cannot be deleted; tell the user instead that the single finding had no line the API would accept. And if findings remain, rebuild `body` to match how many actually go out: it was written before the drop, so it otherwise announces a question that is no longer there.
3. **No candidate qualifies and the offender is unknown, or item 2 has been spent** — post each finding on its own with `gh api repos/{owner}/{repo}/pulls/{number}/comments -X POST` (`commit_id`, `path`, `line`, `side`, `body`). Each of these calls stands alone: one that returns 201 has published its comment for good, and one that returns 422 has published nothing. Work down the list once, skip the finding whose line the API rejected, and never resend one that already returned 201.

Do not reply to your own comments, do not resolve them, do not edit the code — publishing findings is the whole job.

When done, print one summary line: how many comments were posted, in which files, which findings were dropped on 422, and whether they went out as one review or as separate comments.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Comments posted to the PR — always English.

## Extra context

If the user passed anything along with the invocation — a PR number, an area to focus on, a specific worry — treat it as the scope of the review. It arrives below; an empty line there means no arguments were given, not that something went missing.

$ARGUMENTS
