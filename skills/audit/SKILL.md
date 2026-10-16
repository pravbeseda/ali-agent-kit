---
name: audit
description: Audit a whole repository, or one folder of it, as it stands — security, architecture, correctness, duplication, dead code, stale docs and finished plans — with one finder and one independent verifier per lens, and write the ranked result as dated Markdown files under docs/audit/. Changes no code. Claude Code only, manual-only — use it only when the user explicitly asks for an audit of the codebase, or runs /ali-audit.
agents: claude-code
disable-model-invocation: true
---

# Audit

Answer one question about a codebase as it stands: **what in it is wrong now, and what should be fixed first?** There is no change under review. Six finders read the code through one lens each, one verifier per lens tries to disprove what it found, and the survivors land in `docs/audit/{date}/` as a plan of work the owner can pick up: a plain-language state of the project, the first things to do, and one file per lens.

> **Not `ali-review-branch` / `ali-review-pr`:** those judge a change against the code before it. This one judges the code itself, so its definition of a finding is its own — but what survives one, the evidence and growth gates, is theirs word for word.
> **Not a fixer.** The audit writes into its own folder and nowhere else. Fixing is a separate step the owner takes, finding by finding, in whatever way they choose.

It runs on Claude Code subagents — up to twelve per run, all on one tier — so it starts when the user asks for it and never on its own.

## Step 1. Scope, ledger and map

**Scope.** The path the user named with the invocation, or the whole repository. Record the commit being audited and whether the working tree is dirty:

```sh
git rev-parse --show-toplevel
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --short
```

Uncommitted changes are audited as they stand on disk; the report names them. A checkout that is not the base branch is audited too, and the report says which branch it was — findings may then be about work that never merged.

**The folder.** `docs/audit/{YYYY-MM-DD}/` with today's date; if it already exists, append `-2`, `-3`. Nothing is written yet.

**The ledger** — what this repository has already decided, read before any finder starts:

- every earlier `docs/audit/*/README.md` and `rejected.md`, newest first: the findings they reported and the ones they turned down
- the open issues on the tracker, when there is one — `gh issue list --state open --limit 200 --json number,title,labels`

**The map.** Read the README, CLAUDE.md / AGENTS.md and the documents they link to (one level deep), the build, CI and deploy config, the dependency manifest, the entry points (main, routes, handlers, jobs, CLI commands), the test layout and the plans the repository keeps. Count what is in scope:

```sh
git ls-files -- {scope} | wc -l
```

Collect the deliberate shortcuts — comments of the form `shortcut: {the limit}, {when to upgrade}`, or `ponytail:` in older code — so a deferral cannot quietly become permanent:

```sh
git grep -nE '(#|//|/[*]|^[[:space:]]*[*]|--|;|<!--)[[:space:]]*(shortcut|ponytail):' -- {scope} ':!docs/audit'
```

An exit code of `1` with no output means there are none. The prefixes cover line comments, block comments and their continuation lines in the common syntaxes; add the repository's own when it uses another (`%`, `'`, `REM`), and say so in the map. The prefix keeps prose that only mentions the convention out; drop any hit that is not a deferral, like a note about a keyboard shortcut.

Write the map down as one block — it is the only picture of the repository the subagents get:

- what the repository is and does, in three sentences, and who runs it — one person, a team, a service under load
- the modules and what each owns
- the main flows: where data comes in, where it is stored, where it goes out
- **the risk areas**: outside input, auth, secrets, data writes, money, state shared between processes, public contracts — with their paths
- the rules the repository writes down for itself, with their source
- the plans and design documents, with their paths
- the shortcut markers: `path:line`, the limit each names and the trigger to revisit it

## Step 2. Collect — one finder per lens

Say in one line that six finders are starting, then dispatch them **in parallel, in one message**: the `Agent` tool, `model: "fable"`, one per lens — security, architecture, correctness, duplication, lean, docs. Each gets [`references/finder-prompt.md`](references/finder-prompt.md) from its `---` line up to its `## Lenses` heading, followed by its own lens section, the map, the scope and the ledger. Nothing else: no chat history, no other lens's brief. A finder that knows what the others look for drifts into their lanes and the report fills with duplicates.

**`opus` only once `fable`'s limit is spent.** A subagent that comes back saying the model's usage limit is reached has done nothing; dispatch that same brief again with `model: "opus"`, and from then on the rest of the run uses `opus` too, so the report names one tier. An empty return or an error is a failed lens, reported in step 6 and in `Not checked`, not a reason to spend the other model.

Wait for all six. Do nothing with partial results.

## Step 3. Verify — one verifier per lens

Dispatch **one verifier per lens that returned findings, in parallel, in one message**, on the same tier: each gets [`references/verifier-prompt.md`](references/verifier-prompt.md) from its `---` line on, the findings of one lens exactly as its finder returned them, the map and the ledger. Never the finder's reasoning, never this conversation — a verifier that sees why a finding was raised confirms it.

Wait for all of them. Then take the verdicts as given: `confirmed` and `plausible` findings go on, `rejected` ones go to `rejected.md` with their ground. Do not overrule a verifier either way; where you think one is wrong, say so in the chat at the end.

## Step 4. Merge and rank

1. **Deduplicate across lenses.** One defect reported by two lenses stays in the lens that comes first in the order below, and the other copy is dropped. A duplication finding whose copies already disagree moves to correctness — or to architecture when the copies are declarations of one contract — and stays `blocking`.
2. **Apply the cap.** Every `blocking` finding stays. Suggestions: at most ten per lens, ranked by how much code or how many concepts acting on them removes; count the rest for `Not included`.
3. **Rank by importance.** `blocking` before `suggestion`; within each, by lens — security, architecture, correctness, duplication, lean, docs — and then by what the problem costs if left.
4. **Work out the fix order.** Start from the ranking and move a finding earlier when its fix moves or rewrites code another finding sits in: restructuring a module goes before deduplicating or trimming inside it, or that work is done twice. Fill `Depends on` from the findings' `touches`.
5. **Assign IDs** per lens in that order: `SEC`, `ARCH`, `COR`, `DUP`, `LEAN`, `DOC`.
6. **Hold it against the last audit.** A finding the newest earlier audit also reported is `carried from {its date}`, with its old ID — or `tracked in #{n}` when an open issue now holds it, with the old ID after it. A finding of that audit the code no longer has goes under `Closed since the last audit` — after checking the code, not because no finder mentioned it; one the finders simply did not reach this time goes under `Not checked` instead.
7. **Build the shortcut ledger** from the map's markers: one row each with its limit and trigger, `no-trigger` on a marker that names no trigger — those are the ones that rot — and the finding's ID on a marker a finder reported as already past its limit.

## Step 5. Write the folder

Write `README.md` always, one file per lens with findings, and `rejected.md` when the verifiers rejected anything, in the layout of [`references/report-template.md`](references/report-template.md). English, whatever the chat language. Write nothing outside the folder.

**The state of the project comes first and in plain words.** It is the part the owner reads when they will read nothing else: what the repository is, how healthy it is, where the risk concentrates. **What to do first** follows it: up to five actions, blocking security and blocking architecture first, each naming the findings it covers and the file to open. An audit with no surviving finding still writes its README — the next audit needs the record that this date came back clean — and says `Nothing to fix.` there, with one line on what was checked.

`Not checked` is never empty by accident: it holds every part of the scope no finder reached, every failed lens and every `plausible` finding's open question. When it truly has nothing, it says so.

## Step 6. Report and hand over

Print to the chat, in the user's language:

1. **The state of the project** — the same plain-language paragraph as the README, translated.
2. **What to do first** — the same options, numbered.
3. One line of counts: raised, confirmed, plausible, rejected, and per label.
4. Any verdict you disagree with, and why, in one line each, and the `Noticed:` lines of finders and verifiers — these stay in the chat, never in the report.

Then the hand-over, which depends on where the audit ran:

```sh
gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name'
```

**On the base branch**, ask once whether to commit the folder on a new branch and open a pull request. This is the only question of the run. On yes — uncommitted changes elsewhere in the tree stay where they are, since the commit names only the folder:

```sh
git switch -c audit/{date}
git add docs/audit/{date}
git commit docs/audit/{date} -m "docs: add codebase audit {date}"
git push -u origin audit/{date}
```

and open the pull request with the README's state of the project and its first actions as the body. On no — a team repository whose owners do not want it, say — the folder stays in the working tree, untracked, and the run ends there.

**On any other branch**, ask nothing: a branch cut from here would carry this branch's unmerged commits into the audit's pull request. Leave the folder untracked and say in one line that it can be committed from the base branch later.

The audit fixes nothing and files no issues. The findings are the owner's to take, one by one.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- The files in `docs/audit/`, the commit and the pull request — always English.

## Extra context

If the user passed anything along with the invocation — a path to audit, a lens to leave out, a worry to look at first — treat it as the scope of this run. It arrives below; an empty line there means no arguments were given, not that something went missing.

$ARGUMENTS
