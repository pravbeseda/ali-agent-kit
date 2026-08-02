---
name: one-by-one
description: Work through the open questions in a plan or list one at a time — context, options with a rated comparison, a recommendation — record each decision, then implement what was decided. Use when the user asks to "go through the questions one by one", "resolve the plan questions", or runs /ali-one-by-one.
---

# Resolve the open questions one by one, then build it

The point of this skill is not to produce a plan. It is to get every open question answered and then implement the result.

## 1. Find the questions

- If the conversation already holds a plan or a list with questions (Q1, Q2, Q3…), use it as it stands — it does not have to exist as a file.
- Otherwise ask the user which plan file to work through, read it, and collect every question (`### Q1:`, `## Q1`, `**Q1**`, and similar).
- Note whether the questions came from a file: that decides where decisions get recorded in step 4.

## 2. Pick the next open question

- Look for decision markers next to each question: `**Decision:**`, `✅`, `[x]`.
- Take the first question **without** one.
- If every question is resolved, go to [step 5](#5-implement).

## 3. Present the question

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Q{N}/{TOTAL}: {short title}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

### Context
Why this question matters, what depends on it,
which later decisions it blocks.

### Options

#### Option A: {name}
{description}

| Criterion | Rating |
|-----------|--------|
| Effort | 🟢 low / 🟡 medium / 🔴 high |
| Fragility | 🟢 robust / 🟡 moderate / 🔴 fragile |
| Anti-patterns | 🟢 none / 🟡 minor / 🔴 present |
| Architectural cleanliness | 🟢 clean / 🟡 acceptable / 🔴 messy |
| Best practices | 🟢 follows / 🟡 tolerable / 🔴 violates |

#### Option B: {name}
…same shape…

### Recommendation
My pick: **Option {X}**
{Why — two or three sentences of concrete reasoning}
```

## 4. Wait for the decision

Once the user picks an option (or proposes their own):

- Record the decision. If the questions came from a file, write `**Decision:** {chosen option and a short rationale}` under the question there, and flip a `[ ]` checkbox to `[x]`. If they live only in the conversation, keep the running list of decisions in your confirmation lines instead — do not create a file for it.
- Confirm briefly: "Q{N} resolved. {M} left."
- **Go straight to the next open question** (step 2 → 3) — do not wait to be invoked again.
- Keep the loop running (present → answer → record → next) until every question is resolved.

## 5. Implement

Once no open question is left, do not stop to write a polished plan document — build what was decided.

- Restate the decisions as one compact list, so the user sees what is about to be built.
- Implement them, in an order the dependencies between the decisions allow.
- Follow the project's conventions and its CLAUDE.md / AGENTS.md, and run whatever check the project uses before calling the work done.
- If a decision turns out to be unbuildable as chosen, stop at that point, say what broke, and put the question back to the user in the step 3 format rather than silently picking something else.

Write a summary document only if the user asks for one; it is not part of this loop.

## Rules

- Exactly one question per message. Wait for the answer, then move on immediately.
- Ratings must be concrete for **this** project, not generic.
- Account for the patterns already in the codebase, and for the project's CLAUDE.md / AGENTS.md conventions when judging anti-patterns.
- If an option touches several layers (backend + frontend + tests), let the effort rating show it.
- If one option is clearly better, say so plainly — do not hide behind "both are fine".

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- What you write into the plan file — the language the plan itself is written in.
- Code, comments and commits from step 5 — the conventions of the project being changed.
