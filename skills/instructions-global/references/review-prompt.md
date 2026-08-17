# Independent review of the applied run

After `apply.js` and the verify step, a **second reader with a clean context**
compares what the run replaced with what it produced and writes a short review.
It sees none of the reasoning that led to the proposal — that is the point: it
judges the result the way the user would when opening the files tomorrow.

## How to run it

1. `node scripts/review.js --run <id>` → `runs/<id>/review/` (before / after /
   diff per file, `README.md` with the table).
2. Ask the user in one line whether to launch the reviewer (invoking the skill
   is that request already; the question makes it explicit for any session rule
   about subagents). Then delegate to a subagent with a fresh context and the
   strongest model available, at least an Opus-class model (Claude Code: `Agent`
   with `model: "opus"` or better; other hosts: their equivalent). Give it only
   the prompt below and the review directory. If the host has no subagents, say so
   to the user and do the review yourself in a separate pass **reading only the
   review directory** — mark the verdict "self-review, no clean context".
3. Show the user the review verbatim, then ask one question:
   **accept the new version, or roll back the run** (`node scripts/restore.js
   --run <id>` — undoes every file of the run; `--path <file>` for one file).
   Rolling back is the user's decision; do nothing until it comes. A partial
   answer ("keep everything except X") → restore that path only, re-render if
   the master or `AGENTS.md` changed, and note it in the report.
4. Put the review text into `runs/<id>/report.md` (section "Independent
   review") and the user's decision under it.

## Prompt for the reviewer

Replace `<review dir>` and `<run id>`; pass nothing else.

```
You are reviewing a change to a developer's AI-agent instruction files. Someone
tidied them; you did not take part and know nothing about the intent. Judge only
what is on disk.

Directory: <review dir> (run <run id>). Read README.md first: one row per
changed file with <n>-<name>.before.md (the file before the change; empty when
the file is new), <n>-<name>.after.md (the file now) and <n>-<name>.diff.
Read every before/after pair in full — the diffs alone hide reordering.

By design of the tool that made the change (do not report these as unexplained,
do report them when they look broken or partial): every generated file starts
with an HTML marker naming its source and a sha256; a "Karpathy Guidelines"
section between `<!-- karpathy-guidelines: begin ... -->` / `end` markers is a
managed block copied from a public source and may appear in every file; VS Code
settings may gain `chat.useClaudeMdFile: false` and
`chat.instructionsFilesLocations["~/.copilot/instructions"] = true` (VS Code
accepts `~` there); legacy files may have been moved into an archive directory
under ~/.agent-instructions; lines may have moved between files (global master,
a repository's AGENTS.md, a parked.md, memory files).

Write a review of at most 25 lines, in English, plain text with three headings:

Improved — what is objectively better: duplicates gone, contradictions
resolved, vague filler removed, clearer structure, secrets removed, translated
lines. Be concrete: quote the line or name the section.

Concerns — anything the user should look at before accepting. In particular:
  - a rule that changed meaning or got weaker (a "never" that became "avoid", a
    dropped exception, a dropped concrete value such as a command, path, flag,
    number);
  - a rule that disappeared and is not covered elsewhere in the after-files
    (a line may have moved to another file — check all pairs before calling it
    lost);
  - a line whose translation or compression reads differently from the original;
  - new content that has no counterpart in any before-file (say where it came
    from if you can tell — a managed block, a moved memory note — or flag it as
    unexplained);
  - files that got much longer or that a tool with a size cap may now reject;
  - anything that looks like a secret, an absolute machine-specific path, or a
    personal preference in a file that other people or cloud agents will read.
  Quote the exact lines (before → after). If you find nothing, say "none".

Verdict — one of: ACCEPT (safe to keep), ACCEPT WITH EDITS (keep, but change
the listed lines), ROLL BACK (something important was lost or altered) — and one
sentence why.

Do not propose a rewrite, do not restyle, do not comment on the choice of tools.
Do not repeat the diff. Do not use markdown tables.
```

## What the user sees

```
Independent review (run <id>, reviewer: <model>, clean context)
<the review, verbatim>

Accept the new version, or roll back?  (roll back = node scripts/restore.js --run <id>;
one file only = --path <file>)
```
