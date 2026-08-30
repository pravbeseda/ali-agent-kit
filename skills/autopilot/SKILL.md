---
name: autopilot
description: Implement a feature end to end with almost no interruption — plan it, then run a step → independent review → fix loop, and stop only for a strategic choice. Manual only: it commits, pushes and opens a pull request on its own, so use it only when the user explicitly hands the work over with /ali-autopilot.
agents: claude-code
disable-model-invocation: true
---

# Autopilot

Take a feature — a sentence, a ticket or a written plan — and come back with a branch, a pull request and a list of every decision taken on the user's behalf. Between those two moments the user is asked nothing except the questions in [§5](#5-when-to-stop-for-the-user), which are the ones that change how the application behaves or where its development goes next.

Two things make that safe, and neither is "try harder". Every step ends at a **review gate** run by subagents that never saw the reasoning behind the code, and every finding they raise is answered by a written ruling — fix it, drop it with a reason, or escalate it. Nothing is dismissed silently.

> **Not `ali-review-branch`:** that skill reviews finished work with the author in front of it. This one writes the work and reviews it as it goes.
> **Not `plan-maker`:** a plan is an artifact of this skill, not its output.

## The standing permissions

Invoking the skill **is** the permission for all of it. Do not ask again, at any point:

- create a working branch off the repository's base branch and work only there
- commit each step as it is accepted
- push that working branch
- open a pull request at the end
- file an issue on the repository's tracker for each `## Parked` finding

And never, whatever a reviewer or the plan says: merge the pull request, force-push, push to the base branch, commit on a branch this run did not create, or act outside the repository (publish, deploy, migrate a live system, call a paid API). Those need the user, through [§5](#5-when-to-stop-for-the-user).

## 1. Which mode

**Mode A — there is no plan yet.** The input is a feature description, a ticket, or one bullet of a larger plan with no detail under it. Start at [§2](#2-phase-0--plan-the-only-interactive-phase).

**Mode B — there is a plan.** The input is, or points at, a file with numbered steps. Skip §2 and go to [§3](#3-set-up-the-run), but first work out what is already done, and **verify it against the code, not against the file**: a checkbox is a claim.

For each step the plan calls done, name the evidence — the commit, the file, the passing test. A step whose evidence you cannot find is open, whatever its checkbox says; say so in one line and carry on. The first step without evidence is where the run starts.

A file that has steps but no done-criteria is a Mode B plan with a Mode A gap: keep its steps and decisions untouched, add the missing criteria yourself under §2's rules, and show them in one block before starting.

## 2. Phase 0 — plan, the only interactive phase

1. **Read the code first.** The files the feature touches, the pattern already used for this kind of thing, the test setup, the repository's CLAUDE.md / AGENTS.md. Say in three lines what you found and what already exists that the feature should reuse.
2. **Write the plan file** — `docs/plans/` or `.github/tasks/`, whichever the repository already uses; create `.github/tasks/` when it has neither. English Markdown, the layout in [§3](#3-set-up-the-run).
3. **Ask every strategic question here, before the loop starts, through `ali-one-by-one`** — one question per message, each with its context, its options and their costs, and your recommendation; record the answer and go straight to the next without waiting to be invoked again. What is front-loaded is the whole run's interactive budget, not the questions into one message: a question that could have been asked in this phase and gets asked in the middle of §4 instead has already broken the promise of the skill. A question is strategic when it matches [§5](#5-when-to-stop-for-the-user); everything else you answer yourself and record.
4. **Record the answers in the plan file** under the step they belong to, then start. Do not ask whether to start.

**A step is a vertical slice with a done-criterion.** Each one names the files it touches and the observable fact that ends it — a named test that goes green, a command whose output changes. "Refactor the service" is not a step; "extract `X` so `y.test.ts` passes unchanged against it" is. A step nobody can verify has no review gate either, which is where autonomous runs turn into a pile of patches.

**Name on each step's line the §4.1 lenses it is expected to fire.** A step that would touch outside input and a stored format at once carries two risks in one diff; splitting it still costs nothing here, while at the gate the step is already committed and the only remaining choice is to review it in full. The lenses are not bookkeeping: their count is what picks the implementer's model in [§4](#4-the-step-loop).

**Aim for three to seven steps.** More than that and the work is not one feature — say so, propose the split, and let the user pick which part this run takes. That is a §5 question.

## 3. Set up the run

**A working tree with uncommitted changes ends the run before it starts.** Say what is dirty and hand it back — branching off the base branch would drag that work along, and reviewing it as part of the feature is exactly the confusion the gates cannot resolve.

Then pick the branch. Resolve the base branch first — the repository default, or the integration branch it actually merges into; never assume `main` blindly.

- **A run being resumed** — Mode B, and the evidence for the plan's finished steps sits on the current branch rather than on the base — **continues on that branch.** Creating a new one off the base would throw the finished steps away.
- **Anything else** branches off the base.

Commit the plan file as the branch's first commit — newly written in Mode A, or extended with the `## Rulings` and `## Parked` sections in Mode B. The file is the run's memory: **conversation context does not survive compaction and a todo list does not either.** Keep the in-session todo list too, but the file is the source of truth.

```markdown
# {Feature}

## Goal
{Two lines: what this does and why.}

## Decisions
- {question} → {answer}, because {why}
{From Phase 0, and from every escalation later.}

## Steps
- [ ] 1. {what} — files: {paths} — lenses: {the §4.1 lenses this step is expected to fire, or none} — done when: {the observable fact}
- [ ] 2. …

## Rulings
{One line per reviewer finding not fixed: what it said, what was decided, why, what it costs if the decision is wrong.}

## Parked
{Real findings outside this run's scope. Each becomes an issue at the end.}
```

Update this file as part of each step's commit. A run that is interrupted must be resumable from it alone — that is the test for whether it holds enough.

## 4. The step loop

For each open step, in order:

1. **Delegate the implementation.** One `Agent` with a clean context, on the tier the step's lens count sets: `opus` for none or one, `fable` for two. Give it the step's text, the files it names, the done-criterion, the repository's CLAUDE.md / AGENTS.md and the command that runs the tests. Tell it to work test-first where the seam already exists — watch the test fail, then make it pass — to write the smallest thing that meets the done-criterion and nothing the criterion did not ask for, to commit nothing, and to return with the question rather than ask it whenever it meets one of [§5](#5-when-to-stop-for-the-user)'s.

   **Routing down is safe only because the bar does not move.** Every reviewer that judges the code against that bar stays on `fable` whatever wrote it, so a weaker implementer costs a round of fixes, never a finding nobody made. Re-read the step against the lens table before dispatching and correct the estimate upward where Phase 0 missed a plane — it is free here, and after the gate the work is already written.
2. **Verify it yourself.** Run the step's tests and read the output. Never write "done" or "passing" without having seen the output in this session; a claim about a command you did not run — the implementer's report included — is the one failure that makes the whole run untrustworthy.
3. **Commit** the step and the updated plan file together.
4. **Run the review gate** ([§4.1](#41-the-review-gate)).
5. **Rule on every finding** ([§4.2](#42-answering-a-reviewer)).
6. **Commit what the gate produced** — the accepted fixes, the new `## Rulings` and `## Parked` lines, the ticked checkbox — as a second commit on the same step, before the next one starts. Ask nobody: the standing permissions cover it. Leave it uncommitted and the next step's commit swallows this step's fixes, so its diff no longer matches its own text and a resumed run reads a plan file that never recorded the rulings.
7. **Start the next step.** Do not report to the user between steps and do not ask whether to continue — they asked for the feature, not for a conversation. A one-line progress note per step is enough.

### 4.1 The review gate

Dispatch **subagents with a clean context, in parallel** — the `Agent` tool, each on the tier named for it below. Each gets the step's diff (`git show` of the step's commits), the step's own text from the plan file, and its own brief. Nothing else — no reasoning, no chat history. That blindness is the point: they judge what the code says, not what it meant.

**Two always run:**

- **Spec reviewer**, `model: "opus"` — does the diff do what this step says, all of it and only it? Its findings are: something the step asked for is missing, something outside the step arrived, the done-criterion is not actually met by what the test asserts.
- **Quality reviewer**, `model: "fable"` — [`references/reviewer-prompt.md`](references/reviewer-prompt.md), the bar `ali-review-branch` uses, unchanged.

The spec reviewer is the only one a tier down: its question is bounded by the step's own text. Everything that judges the code against a bar rather than against a sentence stays on `fable`.

**Then add a lens for each trigger the diff fires, and only those** — on `fable`, like the quality reviewer:

| The diff… | Lens | It looks for |
|---|---|---|
| parses outside input, touches auth, permissions, secrets or a query built from data | security | the input that gets through, the value that leaks, the check that can be skipped |
| changes a public API, a data schema, a storage or config format, or a stored value's meaning | compatibility | what breaks for data written or callers built before this change, and whether a migration exists |

**Structure and tests get no lens of their own.** The quality reviewer's bar already names both — one decision edited in two places, a seam broken, an assertion that cannot fail — and the spec reviewer already asks whether the done-criterion is met by what the test asserts. A second reviewer on a plane somebody is reading anyway buys a duplicate, not a check.

**A lens whose trigger did not fire is not dispatched.** An idle reviewer does not report nothing — it invents something, and a run that argues with speculation is exactly what the ledger is meant to prevent. The ordinary step fires none of them and is reviewed by the two.

**Every lens the diff fires is dispatched.** The step is written, verified and committed by the time the gate runs, so there is nothing left to split here and nothing to gain from reviewing it thinly — the place to make a step narrower is [§2](#2-phase-0--plan-the-only-interactive-phase), where it still can be. Add to the step's line in `## Steps` any lens the gate dispatched that the line does not already name, appended rather than overwriting the estimate, so the line keeps both what set the implementer's tier and which planes were actually checked.

Every lens applies the same bar as the quality reviewer, narrowed to its own plane, and reports `blocking` / `suggestion` findings anchored to `file:line`, or nothing.

**Cap the fix loop at two rounds.** Round one fixes what you accept, round two re-reviews only the fix diff and fixes what it breaks. If a `blocking` finding is still standing after round two, stop the loop and escalate it as a §5 question — a third round is where an agent starts rewriting working code to satisfy a reviewer it does not understand.

### 4.2 Answering a reviewer

**A finding is a claim, not an order.** Check it against the code before you touch anything; a reviewer with no context misreads a call site regularly, and "the reviewer said so" is not a reason to change code that is right.

Every finding gets exactly one of three verdicts, and all three are written down:

- **Fix** — the claim holds and the fix is smaller or clearer than what is there now. You apply it yourself: the implementer has returned, and re-dispatching it would hand a ruled finding to a context that never saw the ruling.
- **Drop, with the reason in `## Rulings`.** Legitimate reasons, and only these: the claim is wrong against the code (say which line disproves it); it has no evidence — no input, path or line where today's code goes wrong; the fix would grow the code and the finding is not `blocking`; it is a `suggestion` about a matter of taste. The last two are where KISS and YAGNI actually get enforced — a guard for a case nobody can reach, an abstraction with one caller, a parameter no caller varies, an option the feature never asked for. Adding it "because a reviewer mentioned it" is exactly how a clean change turns into a patchwork.
- **Escalate** — it matches [§5](#5-when-to-stop-for-the-user), or it is `blocking` and still open after the second round.

A real problem that is outside this step and outside the feature goes to `## Parked`, never into the fix loop.

**Silent dismissal is forbidden.** A finding that is neither fixed nor written into `## Rulings` did not happen, and the user has no way to learn what was decided for them.

## 5. When to stop for the user

Stop for these, and for nothing else:

1. **Behaviour the user will see** and the plan does not already settle — what an error says, what happens on an empty state, what a default is.
2. **A contract that outlives the change** — a public API, a data schema, a storage or config format, a URL.
3. **A new dependency**, or a new version of one that changes behaviour.
4. **Removing or changing behaviour the plan did not name** — including deleting a test, weakening an assertion, or dropping a feature to make a step pass.
5. **Anything irreversible, security-sensitive, or outside the working tree and not on the standing-permissions list** — a merge, a push to a shared branch, a release, a migration, a secret, a paid call.
6. **The plan no longer fits the code** and every way forward is a guess, or a `blocking` finding survived the cap.

Ask in the `ali-one-by-one` shape — context, numbered options with their costs, your recommendation — one question per message, and **resume the loop the moment it is answered**, without asking to resume. Write the answer into `## Decisions`.

Everything not on that list you decide yourself: naming, file layout, which helper to reuse, how to structure a test, how to word an internal comment. Record it only if a reasonable person would have chosen differently.

## 6. The final gate

1. **The whole suite**, plus whatever the repository runs before a commit — lint, types, build. Read the output. A red suite ends the run at the user, not at a PR.
2. **The final review**, over the whole branch diff, clean context: one reviewer on the quality reviewer's tier (`Agent` with `model: "fable"`) with the reviewer prompt, plus every lens of §4.1 whose trigger the **whole** diff fires. What makes this pass stronger is its scope, not its tier — it is the only reviewer that sees the steps together — a schema change in step 2 and its consumers in step 5 only look wrong together. One fix wave, then re-review only the fixes. Its residual findings are ruled on exactly as in §4.2.
3. **Open the pull request** — description via `ali-generate-pr-description` if it is installed, otherwise a plain one: goal, what changed, how it was verified. Push the branch; do not merge, and do not ask to.
4. **File the `## Parked` items** as issues on the repository's tracker, each with its `file:line` and how to see it. A finding that stays in the plan file is lost.
5. **Report**, in this order: what now works and how to see it; every line of `## Rulings` — the decisions taken without the user; the parked issues; anything in the plan that was not done and why.

The rulings list is the whole point of the report. It is the only place the user finds out what was decided for them, and it is what they will read to decide whether the next run gets a longer leash.
