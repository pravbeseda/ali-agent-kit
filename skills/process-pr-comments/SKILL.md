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
          root: comments(first: 1) { nodes { databaseId body path line author { login } } }
          comments(last: 20) {
            totalCount
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
- **Take the tail of each thread, and always keep its head.** `comments(last: 20)` because the newest replies hold the current state — a thread can be settled in its last reply and still sit at `isResolved: false` because nobody clicked resolve. Judge the thread by its end, not its opening. `root` is fetched separately so the original objection is never among the comments the tail drops; it also carries the `databaseId` to reply to in step 4.
- **Notice when a thread is truncated.** `totalCount` is the full length of the thread, so `totalCount > 20` means everything between the root and the last 20 replies is missing from the response. Do not judge such a thread from what you have — read it in full first, by asking for that one thread by its node id:

  ```sh
  gh api graphql -f query='
  query {
    node(id: "{thread_id}") {
      ... on PullRequestReviewThread {
        comments(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes { body author { login } createdAt }
        }
      }
    }
  }'
  ```

  Keep paging with `comments(first: 100, after: "{endCursor}")` while `hasNextPage`. A single `gh api repos/{owner}/{repo}/pulls/comments/{root_databaseId}` is not a substitute: it returns the root comment you already have and none of the replies. If for some reason the thread cannot be read in full, say in step 3 that the middle of the discussion was not read. A verdict like "this was already agreed" is exactly the one a missing middle makes wrong.

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

## Step 5. Close the pass: is another review round worth it?

When no unresolved thread is left, end with a verdict on whether the PR should go through another review round. Judge it by what **this** pass turned up, not by how many comments there were.

**The rule:** while a round is still finding things that change behaviour, another round pays for itself. Once a round produces only wording and polish, stop — the next one will cost attention and return noise.

Sort every thread of this pass into exactly one of three buckets, by **what the assessment concluded**, never by what the comment claimed. `B + P + R` always equals `N`:

- **B — behaviour-changing.** Accepted, and it was about a wrong result or a crash, a call that cannot succeed as written, a silently wrong default, a lost error, a missing case in the logic, or a check that was removed and still had a job to do.
- **P — polish.** Accepted, but it was about wording, naming, comment phrasing, ordering, formatting, a test that reads weaker than it is, or restating something already true elsewhere.
- **R — rejected.** The comment was not acted on. A rejected comment lands here whatever it claimed: one that predicted a crash but turned out not to apply is `R`, not `B`, because there is no defect for the next round to find.

Only `B` moves the verdict.

Print it as the last block of the pass, with the verdict on its own line and nothing after it:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This pass: {N} threads — {B} behavioural, {P} polish, {R} rejected
Heaviest find: {one line, or "none"}

## 🔁 RECOMMENDATION: ANOTHER ROUND
{one or two sentences: which behavioural findings justify it,
and which area they cluster in}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When the pass produced only polish, the block is the same with the verdict line replaced by:

```
## ✅ RECOMMENDATION: STOP HERE
{one or two sentences: this round found only wording-level items,
so the code is not what is holding the PR back}
```

Rules for the verdict:

- Exactly one of the two lines, never both, never a hedged "maybe one more".
- Base it on the findings of this pass only. A long queue of comments that all turned out to be polish still means stop.
- A single behavioural finding is enough to recommend another round. Behavioural defects cluster; a round rarely finds exactly one.
- Rejected threads never argue for another round, however alarming the claim was: they say something about the reviewer, not about the code.
- It is a recommendation. If the user asks for another round after a stop verdict, run it without arguing.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Replies posted to GitHub — always English.

## Extra context

If the user passed anything along with the invocation — a PR number, an author to filter on, a decision already made — treat it as the scope of this pass. It arrives below; an empty line there means no arguments were given, not that something went missing.

$ARGUMENTS
