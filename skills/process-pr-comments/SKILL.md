---
name: process-pr-comments
description: Work through the existing unresolved review comments on a pull request one by one, resolving each thread. Use when the user asks to handle review feedback already posted on a PR, or runs /ali-process-pr-comments.
---

# Process PR comments

Assess the unresolved review comments on a pull request critically, and take the user through a decision on each one.

> **Not `ali-review-pr`:** that skill writes NEW findings onto the PR diff. This one triages the threads that already exist and resolves them.

## Step 1. Fetch the comments

Get the repository and PR number in parallel:

```sh
gh pr view --json number --jq '.number'
gh repo view --json nameWithOwner --jq '.nameWithOwner'
gh api user --jq '.login'
```

The login is the one this pass posts under, which step 3 needs to tell the replies it left on an earlier pass from other people's comments. `gh pr view` without an argument resolves the PR of the current branch; pass the number explicitly when the user named one. If it fails because the branch has no open PR, **stop** and ask which PR to work through.

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
          root: comments(first: 1) { nodes { databaseId body path line author { login __typename } } }
          comments(last: 20) {
            totalCount
            nodes {
              id
              databaseId
              body
              path
              line
              author { login __typename }
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
          nodes { body author { login __typename } createdAt }
        }
      }
    }
  }'
  ```

  Keep paging with `comments(first: 100, after: "{endCursor}")` while `hasNextPage`. A single `gh api repos/{owner}/{repo}/pulls/comments/{root_databaseId}` is not a substitute: it returns the root comment you already have and none of the replies. If for some reason the thread cannot be read in full, say in step 3 that the middle of the discussion was not read. A verdict like "this was already agreed" is exactly the one a missing middle makes wrong.

**An unresolved thread is read whole — every comment in it, not just the last one.** The three parts above exist to make that possible; what makes it necessary is that the state of a thread is rarely in any single comment. A thread `ali-review-pr` reopened is the clearest case: the root holds the finding, a reply in the middle claims a fix, and the last comment says what that fix left standing — read only the end and you are looking at a gap with no idea what it is a gap in. Judge the thread by its end, but read the rest first.

Work through the threads where `isResolved == false`, storing each thread `id`. **Keep the resolved ones as the decision ledger** rather than discarding them: they are what this PR has already settled, and step 3 answers a comment that repeats a settled point from that record instead of arguing it out again.

## Step 2. Summarize, then start

Print one line: how many unresolved comments there are and who left them (people / bots). Then go straight into the first one.

> **Mandatory: show exactly ONE comment at a time.** Present a comment → wait for the user → apply the decision → only then show the next. Never put two or more comments in one message. Two exceptions: several comments about the same thing (one topic, one decision) may be grouped — that is rare — and a machine's comment step 3 decides on its own is never presented at all, only reported in the two lines that step defines.

## Step 3. Assess one comment

For each comment (or group of related ones):

1. Read the affected file to understand the context.
2. Verify the claim factually:
   - "the tests will break" → run the tests
   - "the type is incompatible" → read the type definition
   - "the file does not export X" → read the file
3. Scrutinize bot comments (Copilot, CodeRabbit, …) especially hard — they are often wrong from missing context. **A comment is a machine's when its author's `__typename` is `Bot`, or when its body opens with 🤖** — and a person's otherwise. Do not look for a `[bot]` suffix on the login: GraphQL returns bot logins without it, so `github-actions` and `copilot-pull-request-reviewer` arrive bare and only `__typename` tells them apart from people. The 🤖 half is the other direction: `ali-review-pr` marks every finding it publishes that way, and its comments arrive under the login of whoever the token belongs to, so the author alone reads them as a person's. **The verdict is over the whole thread, not its opening comment: the thread is a machine's only while its root is a machine's and no later comment comes from a person other than the login of step 1**, because the moment someone joins a bot's thread it is a discussion a person is reading. That login is excluded because the replies this skill leaves go out under it, so an earlier pass's own reply would otherwise turn every thread it touched into a person's. The verdict carries into step 4, where it decides whether the reply is shown before it goes out.
4. Check the last reply first: if the thread already agreed on an outcome and only the resolve click is missing, do not re-open the discussion. On a person's thread, say so and offer to just resolve it. On a machine's, that is the single right answer the rule below takes without asking — resolve it and say which reply settled it.

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

### The one case that does not wait

**A machine's thread whose options have a single right answer is decided here, without asking.** Item 3 already settled that the thread is a machine's, and the assessment above already settled what the answer is — the thread settled it itself, the claim is wrong against the code, or it is right and the fix is small and obvious. Presenting that is asking the user to confirm arithmetic, and a bot round is mostly such threads. Decide it, apply step 4, and say in two lines what you decided and on which ground — one of the grounds for rejecting it above, the reply that settled the thread, or the failure the fix removes — instead of the block. Then go straight to the next comment.

**Three things go to the user however obvious they look:**

- **The decision changes what the software does for whoever uses or runs it** — an error message, a default, an empty state, a public contract, a stored format. This one is the reason the rule is narrow: a bot is a fine judge of code and no judge at all of what the product should do.
- **Two or more options are genuinely worth the same**, so choosing between them is a preference rather than a finding.
- **The thread is a person's.** Nothing here changes that; only machine threads are ever decided unattended.

**Weighing it is the answer.** If deciding takes an argument, the option was not obvious, and it goes to the user in the block above.

## Step 4. Apply and move on

Once the decision is made — the user's, or the pass's own on a machine's thread:

1. **If the decision is to change the code** — make the change.
2. **Decide whether a reply is needed at all.** If the last replies already state the outcome and only the resolve click is missing — the case step 3 checks for before presenting anything — post nothing: say in the chat which reply settled it and go straight to item 4. Repeating a decision the thread already holds is exactly the noise that check exists to avoid. **A rejection is the exception: it always gets a reply, naming the ground it fell under.** That reply is the ledger entry the next round reads; a point turned down in silence comes straight back.
3. **A reply to a person is shown before it goes out; a reply to a machine is posted straight away.** Which of the two this thread is was already settled in step 3, and is not re-decided here.

   - **Person** — print the exact text that will go into the thread and wait for the user to approve or correct it. It is published under their name in a place they cannot edit away, so it is the one thing here that is not yours to send unilaterally. This is the only pause in step 4, and it happens only when something is actually being sent to a person.
   - **Machine** — post it without asking, then print in the chat what was sent. No one reads a bot thread for tone, and a bot round is mostly rejections, each of which owes the ledger a reply: stopping for approval on every one is what makes a twenty-comment pass unfinishable.

   **Either way, post the reply from a file, never inline in the command.** Write it with the file-creation tool — not with a heredoc, not with `echo` — into a temp dir, never into the working tree, and let `gh` read it back:

   ```sh
   gh api repos/{owner}/{repo}/pulls/{number}/comments/{root_databaseId}/replies -F body=@{file} --jq '.id'
   ```

   `-F key=@path` reads the value from a file and passes it through as a string, so backticks, quotes, `$`, em dashes and code blocks in the reply never reach the shell. That is the point: a reply body carried in `-f body="…"` or in a heredoc turns into a long or multi-line command, which the integrated terminal echoes back with soft wrapping and `>` continuation prompts until the run looks hung. This command stays one short line however long the reply is.

   **Name the file by the literal absolute path it was written to — never `$TMPDIR`, `~` or any other shell variable.** The shell expands those in the terminal's environment, which is not the one the file-creation tool wrote in: `$TMPDIR` in an editor terminal commonly points somewhere else entirely, so the command names a file that does not exist and fails with `no such file or directory`. Give the file-creation tool an absolute path, then paste that same string into the command.

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

## Step 5. Commit and push the fixes

Once the last thread is resolved, the edits this pass made are still only in the working tree. Land them here, in one commit, and only when some decision actually changed the code — with nothing changed there is nothing to commit, so go straight to step 6.

1. **Check the branch before touching anything.** If `git rev-parse --abbrev-ref HEAD` is the repository's default branch, stop the step and say so: this pass runs on a PR head branch, and a default branch there means something is wrong with the setup, not that a commit is due. The check belongs here rather than at the push, because a commit already made on the default branch has to be moved off it — which is the state this guard exists to prevent, not to report.
2. Read what is there: `git status --short` and `git diff --stat`. If a file this pass edited also carries changes it did not make, say so and let the user decide what to do with them — do not split the file up on your own.
3. **Track any file this pass created**, and only those:

   ```sh
   git add {new path}
   ```

   A pathspec matches tracked paths only, so an untracked one takes the whole commit down with `pathspec '{path}' did not match any file(s) known to git` and nothing is written at all — not even the files that would have matched. This `git add` is narrow on purpose: it names the paths this pass created and no others, so nothing foreign enters the index.

4. **Commit the files this pass touched by naming them, and nothing else** — English message, whatever the language of the chat:

   ```sh
   git commit {path} {path} -m "fix: address review comments on {area}"
   ```

   **Name the paths on the commit itself; never stage everything and commit a bare index.** A bare `git commit` writes whatever the index holds, which includes anything that was already staged before this pass started — so the review-fix commit quietly carries code nobody discussed under a message that does not describe it. Pathspecs commit the named files as they stand on disk and leave the rest of the index exactly where it was, which is what keeps item 3's `git add` from mattering to anything but the new files. `git add -A` and `git add .` are wrong for the same reason, more obviously.

   Pathspecs are per file, not per hunk: a foreign edit sitting inside a file this pass touched goes in with it, which is why item 2 puts it to the user before the commit is made rather than after. Dirty paths outside the named ones stay uncommitted and are reported in step 6.

5. Push to the PR's branch:

   ```sh
   git push
   ```

6. **A rejected push stops the pass** — the remote has moved and the fixes need rebasing onto it. Report it and hand the decision to the user; never `--force`, never `--force-with-lease`, and never a merge to get around it.
7. Report the resulting SHA and branch in the close block below. Leaving fixes uncommitted is what makes the next step read stale code: `ali-review-pr` reviews what GitHub holds, so a fix that never reached the PR is a fix it cannot see.

## Step 6. Close the pass

When no unresolved thread is left, count the threads whose decision **changed the code** in this pass. That count, and nothing else, decides what comes next.

- **None did** — every comment was rejected, deferred or already settled. No code exists that nobody has looked at, so the pass is closed.
- **Some did** — those edits are the only code on this PR that has not been reviewed. Hand them to `ali-review-pr`, which ends with the ready-to-merge verdict.

Print it as the last block of the pass, with the line on its own and nothing after it:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This pass: {N} threads — {C} changed the code, {U} left it as it was
Decided without asking: {n} machine threads, or "none"
Deferred, still open: {one line, or "none"}
Pushed: {sha} → {branch}, or "nothing to commit"

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

- **The `Pushed:` line is always there and always factual.** It names the commit that carries this pass's fixes, or says nothing was committed — and if step 5 could not push, it says that instead of a SHA. It is what tells the user the PR on GitHub now holds what was just decided.
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
