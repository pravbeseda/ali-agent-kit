---
name: one-by-one
description: Work through the open questions in a plan one at a time — context, options with a rated comparison, a recommendation, then record the decision in the plan file. Use when the user asks to "go through the questions one by one", "resolve the plan questions", or runs /ali-one-by-one.
user-invocable: true
---

# Resolve plan questions one by one

## 1. Find the plan

- If the conversation already has a plan with questions (Q1, Q2, Q3…), use it.
- Otherwise ask the user which plan file to work through.
- Read the file and collect every question (`### Q1:`, `## Q1`, `**Q1**`, and similar).

## 2. Pick the next open question

- Look for decision markers next to each question: `**Decision:**`, `✅`, `[x]`.
- Take the first question **without** one.
- If every question is resolved, say so and offer to generate the final version of the plan.

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

- Update the plan file: add `**Decision:** {chosen option and a short rationale}` under the question.
- If the question carried a `[ ]` checkbox, flip it to `[x]`.
- Confirm briefly: "Q{N} resolved. {M} left."
- **Go straight to the next open question** (step 2 → 3) — do not wait to be invoked again.
- Keep the loop running (present → answer → update the file → next) until every question is resolved, then offer to generate the final plan.

## Rules

- Exactly one question per message. Wait for the answer, then move on immediately.
- Ratings must be concrete for **this** project, not generic.
- Account for the patterns already in the codebase, and for the project's CLAUDE.md / AGENTS.md conventions when judging anti-patterns.
- If an option touches several layers (backend + frontend + tests), let the effort rating show it.
- If one option is clearly better, say so plainly — do not hide behind "both are fine".
