# Report template

The layout of `docs/audit/{date}/`, written in [step 5](../SKILL.md#step-5-write-the-folder). English, whatever the language of the chat. Write `README.md` always, a lens file only when the lens has findings, and `rejected.md` only when something was rejected; `README.md` names the lenses that came back clean.

## `README.md`

```markdown
# Audit {date} — {repository}

Audited `{sha}` on `{branch}` · scope: {the path, or "whole repository"}{ · uncommitted changes included: {paths}}

## State of the project

{Four to eight sentences in plain words, for a reader who has never opened the code: what this repository is
and does, how healthy it is, where the risk sits, and how that compares with the last audit if there was one.
No identifiers, no file names, no counts of lines.}

## What to do first

1. {An action, not a finding: "Close the unchecked file path in the export command (SEC-1, SEC-2) — S, security.md"}
2. …

{Up to five options — or `Nothing to fix.` and one line on what was checked — blocking security first, then blocking architecture, then the rest by the fix order below.
Each names the findings it covers, the effort and the file to open.}

## Findings

| ID | Lens | Label | Finding | Effort | Depends on | Status | Verified |
|----|------|-------|---------|--------|------------|--------|----------|
| SEC-1 | security | blocking | {title} | S | — | new | confirmed |
| ARCH-2 | architecture | blocking | {title} | L | — | carried from {date} (was ARCH-1) | confirmed |
| DUP-1 | duplication | suggestion | {title} | M | ARCH-2 | tracked in #{n} | plausible |

{Ordered by importance. Status is the finder's ledger line — new · carried from {date} (was {old ID}) · tracked in #{n} · re-raised: {what changed}. Verified is the verifier's verdict — confirmed · plausible, with what would prove it under Not checked.}

## Fix order

{The IDs in the order to fix them, where it differs from the table: a finding whose fix moves or rewrites code that
another finding sits in goes before it, so the second is not fixed twice. One line each for the reason.}

## Closed since the last audit

{One line per finding of the previous audit that the code no longer has, with its old ID — or "No previous audit."}

## Shortcuts

- `path:line` — limit: {the limit it names} · upgrade: {the trigger, or `no-trigger`}{ · crossed: {finding ID}}

{{n} markers, {m} with no trigger — or "No shortcut markers."}

## Not included

{"{n} more suggestions in {lens} below the cap of 10" per capped lens — or "Nothing."}

Clean lenses: {the lenses that found nothing, or "none"}.

## Not checked

{The parts of the scope no finder reached, every failed lens, and the plausible findings' open questions — or "Nothing that matters."}

## Method

{n} finders ({the lenses that ran; a failed one is named under Not checked}) and one verifier per lens with findings,
each in a clean context, on {model}. Ledger: {the earlier audits read, the open issues read}. {n} findings raised, {c} confirmed,
{p} plausible, {r} rejected{ (see rejected.md) when r > 0}.
```

## `{lens}.md`

One file per lens with findings — `security.md`, `architecture.md`, `correctness.md`, `duplication.md`, `lean.md`, `docs.md` — `blocking` findings first, then suggestions, each in this shape:

```markdown
# {Lens} — audit {date}

## SEC-1 · blocking · {title}

- **Where:** `path:line`
- **What this is:** {what the code does}
- **Problem:** {the input or path, and what goes wrong}
- **Fix direction:** {what fixing involves}
- **If we skip it:** {the cost}
- **Effort:** S · **Touches:** {files} · **Depends on:** — · **Status:** new · **Verified:** confirmed
```

IDs are per audit and per lens: `SEC`, `ARCH`, `COR`, `DUP`, `LEAN`, `DOC`, numbered in the file's order.

## `rejected.md`

```markdown
# Rejected — audit {date}

- **{lens}:** {title} (`path:line`) — {ground} — by verifier
```

The next audit reads this file as its ledger. A finding the owner turns down later belongs here too: append it with `— by owner` and the reason.
