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

Two details that decide whether "every unresolved comment" is true:

- **Page through.** While `pageInfo.hasNextPage`, repeat the query with `reviewThreads(first: 100, after: "{endCursor}")`. A truncated list looks exactly like a complete one.
- **Take the tail of each thread, and always keep its head.** `comments(last: 20)` because the newest replies hold the current state — a thread can be settled in its last reply and still sit at `isResolved: false` because nobody clicked resolve. Judge the thread by its end, not its opening. `root` is fetched separately so the original objection is never among the comments the tail drops; it also carries the `databaseId` to reply to in step 4.

  **`root` is usually a duplicate, not an extra comment.** The tail counts back from the end of the whole thread, so for any thread of 20 or fewer — which is nearly all of them — it already contains the opening comment, and `root.nodes[0].databaseId` equals the `databaseId` of the tail's first entry. Read the thread once: `root` is there to guarantee the head is present and to address the reply, not to be weighed as a separate objection. Treating it as one makes a single argument look like it was raised twice.
- **Notice when a thread is truncated.** `totalCount` is the full length of the thread, and it counts the root comment as well. What you hold is the root plus the comments the tail returned, so the thread is complete while `totalCount` is at most one more than the number of comments in the tail — with `last: 20`, anything up to 21 (the root, plus comments 2 through 21). Only above that does a middle exist that neither part covers. Do not judge such a thread from what you have — read it in full first, by asking for that one thread by its node id:

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
2. **Decide whether a reply is needed at all.** If the last replies already state the outcome and only the resolve click is missing — the case step 3 checks for before presenting anything — post nothing: say in the chat which reply settled it and go straight to item 4. Repeating a decision the thread already holds is exactly the noise that check exists to avoid.
3. **When a reply is going out, show it before posting.** Print the exact text that will go into the thread and wait for the user to approve or correct it. It is published under their name in a place they cannot edit away, so it is the one thing here that is not yours to send unilaterally. This is the only pause in step 4, and it happens only when something is actually being sent.
   ```sh
   gh api repos/{owner}/{repo}/pulls/{number}/comments/{root_databaseId}/replies -f body="the approved text, in English"
   ```
4. **Resolve the thread either way** — whether the comment was acted on or rejected, and whether or not a reply was needed:
   ```sh
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "{thread_id}"}) { thread { isResolved } } }'
   ```
5. Move to the next comment **immediately** — no further pauses, no confirmations.

> **Note:** `PullRequestReviewComment` has no `pullRequestReviewThread` field. Thread IDs must come from the PR's `reviewThreads` (step 1).

## Step 5. Close the pass: is another review round worth it?

When no unresolved thread is left, end with a verdict on whether the PR should go through another review round. Judge it by what **this** pass turned up, not by how many comments there were.

**The rule:** while a round is still finding things that change behaviour, another round pays for itself. Once a round produces only wording and polish, stop — the next one will cost attention and return noise.

Sort every thread of this pass into exactly one of five buckets, by **what the assessment concluded**, never by what the comment claimed. `N` counts threads, not assessments: when step 3 settled several threads in one go, each of them still gets its own bucket — usually the same one, but a grouped assessment that accepted one thread and rejected another splits them. That keeps `B + P + S + D + R == N` exact and the number equal to what the PR shows as resolved:

- **B — behaviour-changing.** Accepted, and it was about a wrong result or a crash, a call that cannot succeed as written, a silently wrong default, a lost error, a missing case in the logic, or a check that was removed and still had a job to do.
- **P — polish.** Accepted, but it was about wording, naming, comment phrasing, ordering, formatting, a test that reads weaker than it is, or restating something already true elsewhere.
- **S — settled earlier.** The thread already recorded its outcome before this pass, so step 4 posted nothing and only clicked resolve. It belongs to whichever round did the work, not this one: counting it as `B` would recommend another round for work already finished, and counting it as `R` would misreport a reviewer whose point was taken.
- **D — deferred.** The comment was found valid and the work was not done in this pass: out of scope, tracked separately, waiting on something else. Accepted in judgement, unfinished in the code, which is why it is neither `B` nor `P` nor `R` — filing it under `R` would misreport a reviewer who was right.
- **R — rejected.** The comment was not acted on. A rejected comment lands here whatever it claimed: one that predicted a crash but turned out not to apply is `R`, not `B`, because there is no defect for the next round to find.

Only `B` and `D` move the verdict, and `D` only when what was deferred is behaviour-changing: the defect is real, acknowledged and still in the code, so the next round will meet its consequences. A deferred polish item changes nothing.

Print it as the last block of the pass, with the verdict on its own line and nothing after it:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This pass: {N} threads — {B} behavioural, {P} polish, {S} settled earlier, {D} deferred, {R} rejected
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
