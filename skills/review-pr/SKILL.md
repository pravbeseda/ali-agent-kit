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

No questions, no confirmations: publish all findings straight away, as **one** review — a human reviewer leaves a single review, not eight loose comments. One call, so the author gets one notification and a half-published review is impossible:

```sh
gh api repos/{owner}/{repo}/pulls/{number}/reviews -X POST --input - <<'JSON'
{
  "commit_id": "{sha}",
  "event": "COMMENT",
  "comments": [
    { "path": "{path}", "line": {line}, "side": "RIGHT", "body": "{the finding, in English}" }
  ]
}
JSON
```

Use `"side": "LEFT"` for deleted lines. Write the JSON to a file and pass `--input {file}` instead when a finding's body contains characters that would be awkward inside a heredoc.

**On 422** — a line the API will not accept takes the whole batch down with it. Read which entry it names, drop that one finding, and retry **once**. Never retry the same payload unchanged, and never re-post the entries that a successful call already published.

Do not reply to your own comments, do not resolve them, do not edit the code — publishing findings is the whole job.

When done, print one summary line: how many comments were posted, in which files, and which findings were dropped on 422.

## Language

- Discussion with the user — the language they write in.
- Comments posted to the PR — always English.

## Extra context

If the user passed anything along with the invocation — a PR number, an area to focus on, a specific worry — treat it as the scope of the review.
