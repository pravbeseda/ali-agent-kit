---
name: review-pr
description: Review a pull request and post the findings as inline comments on the code through gh api, the way a human reviewer does — questions and doubts only, no fixes and no ready-made solutions. Use when the user asks to "review the PR", "post a review on the PR", "leave comments on the PR", "comment on the PR as a reviewer", or runs /ali-review-pr.
---

# Review PR

Review the changes in a pull request and publish each finding as an inline comment on the exact line, through `gh api` — the way a human reviewer works: point at the problem or the doubt, do not fix the code and do not hand over a finished solution.

> **Not `ali-process-pr-comments`:** that skill triages existing threads and resolves them. This one posts NEW comments on the PR diff.
> **Not a summary review:** every finding is its own inline comment on a line. Do not write one big review comment, and do not apply fixes.

## Step 1. PR context

Fetch in parallel:

```sh
gh pr view --json number,headRefOid --jq '{number: .number, sha: .headRefOid}'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
gh pr diff {number}
```

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

No questions, no confirmations: post every finding straight away.

```sh
gh api repos/{owner}/{repo}/pulls/{number}/comments \
  -f body="{the finding, in English}" \
  -f commit_id="{sha}" \
  -f path="{path}" \
  -F line={line} \
  -f side=RIGHT
```

Use `side=LEFT` for deleted lines.

Do not reply to your own comments, do not resolve them, do not edit the code — publishing findings is the whole job.

When done, print one summary line: how many comments were posted, and in which files.

## Language

- Discussion with the user — the language they write in.
- Comments posted to the PR — always English.

## Context for the analysis

$ARGUMENTS
