---
name: process-pr-comments
description: Work through the unresolved review comments on a pull request one by one — verify each claim, decide with the user, apply the change and resolve the thread. Use when the user asks to "process PR comments", "go through the review comments", "handle the PR feedback", or runs /ali-process-pr-comments.
---

# Process PR comments

Assess the unresolved review comments on a pull request critically, and take the user through a decision on each one.

## Step 1. Fetch the comments

Get the repository and PR number in parallel:

```sh
gh pr view --json number --jq '.number'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

Load the review threads with their thread IDs — the ID is required to resolve a thread in step 4:

```sh
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: {number}) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          comments(first: 5) {
            nodes {
              id
              databaseId
              body
              path
              line
              author { login }
              createdAt
            }
          }
        }
      }
    }
  }
}'
```

Keep only threads where `isResolved == false` and store each thread `id`. Ignore resolved threads entirely.

## Step 2. Summarize, then start

Print one line: how many unresolved comments there are and who left them (people / bots). Then go straight into the first one.

> **Mandatory: show exactly ONE comment at a time.** Present a comment → wait for the user → apply the decision → only then show the next. Never put two or more comments in one message. The single exception: several comments about the same thing (one topic, one decision) may be grouped — that is rare.

## Step 3. Assess one comment

For each comment (or group of related ones):

1. Read the affected file to understand the context.
2. Verify the claim factually:
   - "the tests will break" → run the tests
   - "the type is incompatible" → read the type definition
   - "the file does not export X" → read the file
3. Scrutinize bot comments (Copilot, CodeRabbit, …) especially hard — they are often wrong from missing context.

### Presentation format

```
### Comment N/M — [short topic]
**File:** path:line | **Author:** username

> Quote of the comment (short, the gist)

**Context:** what the code does here (show the relevant snippet)

**Assessment:**
- Correct: yes / partly / no
- Worth doing: needed / nice to have / no
- Over-engineering: yes / no
- Effort: small / medium / large

**Options:**
1. [Option] — description
2. Ignore — reasoning

**Recommendation:** option N — why
```

Wait for the user's decision. Do not move on until they answer.

## Step 4. Apply and move on

Once the user decides:

1. **If the decision is to change the code** — make the change.
2. **Resolve the thread either way** — whether the comment was acted on or rejected:
   ```sh
   gh api repos/{owner}/{repo}/pulls/{number}/comments/{comment_id}/replies -f body="the decision, in English"
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "{thread_id}"}) { thread { isResolved } } }'
   ```
3. Move to the next comment **immediately** — no pauses, no confirmations.

> **Note:** `PullRequestReviewComment` has no `pullRequestReviewThread` field. Thread IDs must come from the PR's `reviewThreads` (step 1).

## Language

- Discussion with the user — the language they write in.
- Replies posted to GitHub — always English.

## Context for the analysis

$ARGUMENTS
