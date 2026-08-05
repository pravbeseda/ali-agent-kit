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

Work through the threads where `isResolved == false`, storing each thread `id`. **Keep the resolved ones as the decision ledger** rather than discarding them: they are what this PR has already settled, and step 3 answers a comment that repeats a settled point from that record instead of arguing it out again.

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

### Grounds for rejecting it

A review comment is a proposal, and most proposals cost code. Rejecting one is a normal outcome, not insubordination — but name which ground it falls under:

- **It repeats a settled point.** A resolved thread in the ledger already weighed it and said no. It comes back only if its worth has visibly risen since — the code around it changed, or the case it predicted became reachable — and the reply says what changed.
- **Its case is unreachable.** The failure it claims needs an input, state or caller that cannot occur here. Grep for the caller before believing one exists.
- **It only adds code.** A guard, a fallback, a retry, a flag or a branch for something nobody can trigger. The PR ends up longer and more brittle and no defect is gone — that is the trade to refuse, and refusing it is the point of assessing at all.
- **It is factually wrong.** The check in item 2 disproved it.
- **The written approach is equally valid.** Where two designs both hold up on engineering grounds, the one already in the code wins; a reviewer's preference is not a reason to rewrite.

Accept freely in the other direction: a comment that **removes** code or a concept, or that fixes a failure you can name and trigger, is worth doing even when it is small.

### Presentation format

```
### Comment N/M — [short topic]
**File:** path:line | **Author:** username

> Quote of the comment (short, the gist)

**Context:** what the code does here (show the relevant snippet)

**Assessment:**
- Correct: yes / partly / no
- Worth doing: needed / nice to have / no
- Net effect on the code: removes / neutral / adds
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
2. **Decide whether a reply is needed at all.** If the last replies already state the outcome and only the resolve click is missing — the case step 3 checks for before presenting anything — post nothing: say in the chat which reply settled it and go straight to item 4. Repeating a decision the thread already holds is exactly the noise that check exists to avoid. **A rejection is the exception: it always gets a reply, naming the ground it fell under.** That reply is the ledger entry the next round reads; a point turned down in silence comes straight back.
3. **When a reply is going out, show it before posting.** Print the exact text that will go into the thread and wait for the user to approve or correct it. It is published under their name in a place they cannot edit away, so it is the one thing here that is not yours to send unilaterally. This is the only pause in step 4, and it happens only when something is actually being sent.

   **Post the approved text from a file, never inline in the command.** Write it with the file-creation tool — not with a heredoc, not with `echo` — into a temp dir, never into the working tree, and let `gh` read it back:

   ```sh
   gh api repos/{owner}/{repo}/pulls/{number}/comments/{root_databaseId}/replies -F body=@{file} --jq '.id'
   ```

   `-F key=@path` reads the value from a file and passes it through as a string, so backticks, quotes, `$`, em dashes and code blocks in the reply never reach the shell. That is the point: a reply body carried in `-f body="…"` or in a heredoc turns into a long or multi-line command, which the integrated terminal echoes back with soft wrapping and `>` continuation prompts until the run looks hung. This command stays one short line however long the reply is.

   **If a post's outcome is unknown, read before resending.** A reply command that appears to hang may already have created the comment, and a blind retry posts it twice. List the thread's replies first and only resend when yours is genuinely absent:

   ```sh
   gh api --paginate repos/{owner}/{repo}/pulls/{number}/comments --jq '.[] | select(.in_reply_to_id == {root_databaseId}) | .body'
   ```
4. **Resolve the thread either way** — whether the comment was acted on or rejected, and whether or not a reply was needed:
   ```sh
   gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "{thread_id}"}) { thread { isResolved } } }'
   ```
5. Move to the next comment **immediately** — no further pauses, no confirmations.

> **Note:** `PullRequestReviewComment` has no `pullRequestReviewThread` field. Thread IDs must come from the PR's `reviewThreads` (step 1).

## Step 5. Close the pass

When no unresolved thread is left, count the threads whose decision **changed the code** in this pass. That count, and nothing else, decides what comes next.

- **None did** — every comment was rejected, deferred or already settled. No code exists that nobody has looked at, so the pass is closed.
- **Some did** — those edits are the only code on this PR that has not been reviewed. Hand them to `ali-review-pr`, which ends with the ready-to-merge verdict.

Print it as the last block of the pass, with the line on its own and nothing after it:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This pass: {N} threads — {C} changed the code, {U} left it as it was
Deferred, still open: {one line, or "none"}

## 🔁 NEXT: VERIFY THE FIXES
{one line: which files this pass changed}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

When nothing changed, the block is the same with the verdict line replaced by:

```
## ✅ PASS CLOSED — NOTHING TO VERIFY
{one line: why every comment was rejected, deferred or already settled}
```

Rules for the close:

- **Never recommend a fresh review of the whole PR.** Code this pass did not touch was reviewed already, and reviewing it again is precisely what turns a review into a loop. Only the edits made here are new.
- Whether the PR is ready to merge is not this skill's call, and neither is "one more round" — verifying the fixes answers both, and `ali-review-pr` prints that verdict.
- The count is of threads, not of assessments: when step 3 settled several at once, each still counts on its own, so `C + U == N` and the number matches what the PR shows as resolved.
- A rejected comment never argues for more review, however alarming its claim was: it says something about the reviewer, not about the code.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Replies posted to GitHub — always English.

## Extra context

If the user passed anything along with the invocation — a PR number, an author to filter on, a decision already made — treat it as the scope of this pass. It arrives below; an empty line there means no arguments were given, not that something went missing.

$ARGUMENTS
