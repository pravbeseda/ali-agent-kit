---
name: autopilot
description: Implement a feature end to end with almost no interruption — plan it, then run a step → independent review → fix loop, and stop only for a strategic choice. Use when the user asks to implement something on its own, hands over a plan to be executed, or runs /ali-autopilot.
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
- open a pull request at the end

And never, whatever a reviewer or the plan says: merge the pull request, force-push, push to the base branch, commit on a branch this run did not create, or act outside the repository (publish, deploy, migrate a live system, call a paid API). Those need the user, through [§5](#5-when-to-stop-for-the-user).

## 1. Which mode

**Mode A — there is no plan yet.** The input is a feature description, a ticket, or one bullet of a larger plan with no detail under it. Start at [§2](#2-phase-0--plan-the-only-interactive-phase).

**Mode B — there is a plan.** The input is, or points at, a file with numbered steps. Skip §2 and go to [§3](#3-set-up-the-run), but first work out what is already done, and **verify it against the code, not against the file**: a checkbox is a claim.

For each step the plan calls done, name the evidence — the commit, the file, the passing test. A step whose evidence you cannot find is open, whatever its checkbox says; say so in one line and carry on. The first step without evidence is where the run starts.

A file that has steps but no done-criteria is a Mode B plan with a Mode A gap: keep its steps and decisions untouched, add the missing criteria yourself under §2's rules, and show them in one block before starting.

## 2. Phase 0 — plan, the only interactive phase

1. **Read the code first.** The files the feature touches, the pattern already used for this kind of thing, the test setup, the repository's CLAUDE.md / AGENTS.md. Say in three lines what you found and what already exists that the feature should reuse.
2. **Write the plan file** — `docs/plans/` or `.github/tasks/`, whichever the repository already uses; create `.github/tasks/` when it has neither. English Markdown, the layout in [§3](#3-set-up-the-run).
3. **Ask every strategic question at once**, in one message, numbered, each with its options, their costs and your recommendation — the `ali-one-by-one` shape. This is the whole interactive budget of the run: a question that could have been asked here and gets asked in the middle of §4 instead has already broken the promise of the skill. A question is strategic when it matches [§5](#5-when-to-stop-for-the-user); everything else you answer yourself and record.
4. **Record the answers in the plan file** under the step they belong to, then start. Do not ask whether to start.

**A step is a vertical slice with a done-criterion.** Each one names the files it touches and the observable fact that ends it — a named test that goes green, a command whose output changes. "Refactor the service" is not a step; "extract `X` so `y.test.ts` passes unchanged against it" is. A step nobody can verify has no review gate either, which is where autonomous runs turn into a pile of patches.

**Aim for three to seven steps.** More than that and the work is not one feature — say so, propose the split, and let the user pick which part this run takes. That is a §5 question.

## 3. Set up the run

**A working tree with uncommitted changes ends the run before it starts.** Say what is dirty and hand it back — branching off the base branch would drag that work along, and reviewing it as part of the feature is exactly the confusion the gates cannot resolve.

Then pick the branch. Resolve the base branch first — the repository default, or the integration branch it actually merges into; never assume `main` blindly.

- **A run being resumed** — Mode B, and the evidence for the plan's finished steps sits on the current branch rather than on the base — **continues on that branch.** Creating a new one off the base would throw the finished steps away.
- **Anything else** branches off the base.

Commit the plan file as the branch's first commit — newly written in Mode A, or extended with the `## Rulings` and `## Parked` sections in Mode B. The file is the run's memory: **conversation context does not survive compaction and a todo list does not either.** Keep the in-session todo list too if the host has one, but the file is the source of truth.

```markdown
# {Feature}

## Goal
{Two lines: what this does and why.}

## Decisions
- {question} → {answer}, because {why}
{From Phase 0, and from every escalation later.}

## Steps
- [ ] 1. {what} — files: {paths} — done when: {the observable fact}
- [ ] 2. …

## Rulings
{One line per reviewer finding not fixed: what it said, what was decided, why, what it costs if the decision is wrong.}

## Parked
{Real findings outside this run's scope. Each becomes an issue at the end.}
```

Update this file as part of each step's commit. A run that is interrupted must be resumable from it alone — that is the test for whether it holds enough.

## 4. The step loop

For each open step, in order:

1. **Implement it.** Test-first where the seam already exists — watch the test fail, then make it pass. Write the smallest thing that meets the done-criterion and nothing the criterion did not ask for.
2. **Verify.** Run the step's tests and read the output. Never write "done" or "passing" without having seen the output in this session; a claim about a command you did not run is the one failure that makes the whole run untrustworthy.
3. **Commit** the step and the updated plan file together.
4. **Run the review gate** ([§4.1](#41-the-review-gate)).
5. **Rule on every finding** ([§4.2](#42-answering-a-reviewer)).
6. **Tick the step off and start the next one.** Do not report to the user between steps and do not ask whether to continue — they asked for the feature, not for a conversation. A one-line progress note per step is enough.

### 4.1 The review gate

Dispatch **subagents with a clean context, in parallel**, on a fast model — Claude Code: the `Agent` tool with `model: "fable"`; another host: its fast tier. Each gets the step's diff (`git show` of the step's commits), the step's own text from the plan file, and its own brief. Nothing else — no reasoning, no chat history. That blindness is the point: they judge what the code says, not what it meant.

**Two always run:**

- **Spec reviewer** — does the diff do what this step says, all of it and only it? Its findings are: something the step asked for is missing, something outside the step arrived, the done-criterion is not actually met by what the test asserts.
- **Quality reviewer** — [`references/reviewer-prompt.md`](references/reviewer-prompt.md), the bar `ali-review-branch` uses, unchanged.

**Then add a lens for each trigger the diff fires, and only those:**

| The diff… | Lens | It looks for |
|---|---|---|
| parses outside input, touches auth, permissions, secrets or a query built from data | security | the input that gets through, the value that leaks, the check that can be skipped |
| changes a public API, a data schema, a storage or config format, or a stored value's meaning | compatibility | what breaks for data written or callers built before this change, and whether a migration exists |
| is mostly test code — a test-only step, or a suite for behaviour nothing covered before | tests | a test green against unchanged code, a path the step claims covered and does not, a suite that pins the implementation instead of the behaviour |
| adds a module, moves a responsibility, or introduces a seam | structure | the decision now edited in two places, the layer that gained a reason to change, the seam that leaks its other side |

**A lens whose trigger did not fire is not dispatched.** An idle reviewer does not report nothing — it invents something, and a run that argues with speculation is exactly what the ledger is meant to prevent. The ordinary step fires none of them and is reviewed by the two. **Cap the gate at four subagents — the two, plus at most two lenses;** a step that fires three is doing too much and gets split rather than reviewed by a committee. Note the added lenses on the step's line in `## Steps`, so the report says which planes were actually checked.

Every lens applies the same bar as the quality reviewer, narrowed to its own plane, and reports `blocking` / `suggestion` findings anchored to `file:line`, or nothing.

**Cap the fix loop at two rounds.** Round one fixes what you accept, round two re-reviews only the fix diff and fixes what it breaks. If a `blocking` finding is still standing after round two, stop the loop and escalate it as a §5 question — a third round is where an agent starts rewriting working code to satisfy a reviewer it does not understand.

### 4.2 Answering a reviewer

**A finding is a claim, not an order.** Check it against the code before you touch anything; a reviewer with no context misreads a call site regularly, and "the reviewer said so" is not a reason to change code that is right.

Every finding gets exactly one of three verdicts, and all three are written down:

- **Fix** — the claim holds and the fix is smaller or clearer than what is there now.
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
5. **Anything irreversible, security-sensitive, or outside the working tree** — a merge, a push to a shared branch, a release, a migration, a secret, a paid call.
6. **The plan no longer fits the code** and every way forward is a guess, or a `blocking` finding survived the cap.

Ask in the `ali-one-by-one` shape — context, numbered options with their costs, your recommendation — one question per message, and **resume the loop the moment it is answered**, without asking to resume. Write the answer into `## Decisions`.

Everything not on that list you decide yourself: naming, file layout, which helper to reuse, how to structure a test, how to word an internal comment. Record it only if a reasonable person would have chosen differently.

## 6. The final gate

1. **The whole suite**, plus whatever the repository runs before a commit — lint, types, build. Read the output. A red suite ends the run at the user, not at a PR.
2. **The final review**, over the whole branch diff, clean context: one reviewer on the strongest model available (Claude Code: `Agent` with `model: "opus"` or better) with the reviewer prompt, plus every lens of §4.1 whose trigger the **whole** diff fires — a schema change in step 2 and its consumers in step 5 only look wrong together. One fix wave, then re-review only the fixes. Its residual findings are ruled on exactly as in §4.2.
3. **Open the pull request** — description via `ali-generate-pr-description` if it is installed, otherwise a plain one: goal, what changed, how it was verified. Push the branch; do not merge, and do not ask to.
4. **File the `## Parked` items** as issues on the repository's tracker, each with its `file:line` and how to see it. A finding that stays in the plan file is lost.
5. **Report**, in this order: what now works and how to see it; every line of `## Rulings` — the decisions taken without the user; the parked issues; anything in the plan that was not done and why.

The rulings list is the whole point of the report. It is the only place the user finds out what was decided for them, and it is what they will read to decide whether the next run gets a longer leash.

## When the host has no subagents

Say so in one line, then run each gate yourself as a **separate pass that reads only the diff and the step text** — no reference to what you were thinking while writing it — and mark every verdict "self-review, no clean context". A gate done this way catches less; the user is entitled to know which kind they got.
