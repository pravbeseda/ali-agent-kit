---
name: process-pr-comments
description: Work through the unresolved review comments on a pull request one by one — verify each claim, decide with the user, apply the change and resolve the thread. Use when the user asks to "process PR comments", "go through the review comments", "handle the PR feedback", or runs /ali-process-pr-comments.
---

# Process PR comments

Assess the unresolved review comments on a pull request critically, and take the user through a decision on each one.

> **Not `ali-review-pr`:** that skill writes NEW findings onto the PR diff. This one triages the threads that already exist and resolves them.

## Step 1. Fetch the comments

Get the repository and PR number in parallel:

```sh
gh pr view --json number --jq '.number'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

`gh pr view` without an argument resolves the PR of the current branch; pass the number explicitly when the user named one. If it fails because the branch has no open PR, **stop** and ask which PR to work through.

Load the review threads with their thread IDs — the ID is required to resolve a thread in step 4:

```sh
gh api graphql -f query='
query {
  repository(owner: "{owner}", name: "{repo}") {
    pullRequest(number: {number}) {
      reviewThreads(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          root: comments(first: 1) { nodes { databaseId } }
          comments(last: 20) {
            nodes {
              id
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

Two details that decide whether "every unresolved comment" is true:

- **Page through.** While `pageInfo.hasNextPage`, repeat the query with `reviewThreads(first: 100, after: "{endCursor}")`. A truncated list looks exactly like a complete one.
- **Take the tail of each thread.** `comments(last: 20)` because the newest replies hold the current state — a thread can be settled in its last reply and still sit at `isResolved: false` because nobody clicked resolve. Judge the thread by its end, not its opening. `root` carries the `databaseId` of the first comment, which is the one to reply to in step 4.

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
4. Check the last reply first: if the thread already agreed on an outcome and only the resolve click is missing, do not re-open the discussion — say so and offer to just resolve it.

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
   gh api repos/{owner}/{repo}/pulls/{number}/comments/{root_databaseId}/replies -f body="the decision, in English"
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "{thread_id}"}) { thread { isResolved } } }'
   ```
3. Move to the next comment **immediately** — no pauses, no confirmations.

> **Note:** `PullRequestReviewComment` has no `pullRequestReviewThread` field. Thread IDs must come from the PR's `reviewThreads` (step 1).

## Language

- Discussion with the user — the language they write in.
- Replies posted to GitHub — always English.

## Extra context

If the user passed anything along with the invocation — a PR number, an author to filter on, a decision already made — treat it as the scope of this pass.
