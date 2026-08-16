# Cleanup rubric

Shared by `instructions-global` and `instructions-project`. Every input rule
line gets exactly one label; nothing disappears silently; every label appears in
the full report with its reason. Headings, blank lines, HTML comments and fence
delimiters are structure, not rules: they carry no label (a heading whose lines
all leave disappears with them). The scripts (`dupes.js`) only give hints — the
labels are yours, and the FLAG batches are the user's.

## Labels — closed set

| Label | Meaning | Required in the report |
|---|---|---|
| `KEEP` | carried verbatim (or with a REWORD noted separately) | — |
| `REWORD` | compressed or translated to English; **no meaning change** | before → after |
| `MERGE(→ line)` | folded into a surviving line that says the same | the surviving line |
| `MOVE(→ target)` | belongs elsewhere (project canon, master, parked, memory) | the target |
| `DROP:<code>` | removed, with evidence (codes below) | code + evidence |
| `FLAG` | the user decides; blocks the next step | the question, the batch name |

### DROP codes and the evidence each one needs

- `DUP` — a duplicate; name the surviving line. Exact duplicates only, after
  normalisation (case, punctuation, list markers). "Similar" is a MERGE, not a DUP.
- `KARPATHY` — fully covered by a section of the Karpathy block; name the section
  ("§2 Simplicity First"). If the user's line is stricter or more specific than
  the section, it is **not** a DROP: keep the delta in "Local additions" right
  after the block, phrased as a delta ("In addition to §2: …") — label it
  `REWORD` with `after` = the delta line and `to` = "Local additions".
- `VAGUE` — changes no behaviour and carries no specifics ("write good code",
  "be careful", "follow best practices").
- `STALE` — evidence required: the path does not exist on this machine, the tool
  is not installed, or a later and more specific line contradicts it. Say which.
  No evidence → `FLAG`, never `DROP:STALE`. A *relative* path in a global file
  ("`scripts/old-build.sh`") is weak evidence — it may exist in some repo — so
  that is a `FLAG`, not a `DROP:STALE`.
- `SECRET` — token, key, password, connection string. Remove, and warn
  separately (also that it must not sit in git). `dupes.js` points at candidates.
- `DEFAULT` — behaviour the agents show without being told ("use meaningful
  variable names", "write tests for new code"). **Never applied by the model
  alone**: such lines go into the FLAG batch `DEFAULT` ("proposed to drop as
  default behaviour"); the user approves the batch in bulk or line by line. Only
  after that approval does the label become `DROP:DEFAULT` in the report.

## Never cut

- Prohibitions and safety rules ("never push to main", "ask before touching
  migrations"): only MERGE exact duplicates, and never soften the wording — when
  two versions differ in strength, the stricter one survives.
- Concrete values — commands, paths, flags, ports, numbers, versions — are
  carried verbatim.
- Examples that change behaviour stay; examples that merely illustrate go.

## Conflicts are not duplicates

- MERGE never resolves a conflict: two contradicting lines → `FLAG` with both.
- A project line versus a global line is not a duplicate: the project line stays
  (project overrides global). Report the pair as an override, not a conflict.
- Duplicates between a project file and the global master are kept by default
  (cloud agents and teammates do not have the global); compress the wording,
  remove duplication *inside* the project file. Only with `--assume-global` may
  such a line be dropped as `DROP:DUP` with the master line named.

## REWORD rules

- Compress and translate to English only. Anything that would change meaning is
  a `FLAG`, not a REWORD.
- Result style: imperative, one rule per line, no filler, no headings without content.
- Every REWORD is listed as before → after in the report so the user can
  proofread exactly those lines.

## MOVE targets

From the global files:
- project-specific line → that project's canon (`AGENTS.md`) when the project
  exists on this machine (guess the path from the memory slug or an explicit
  mention; the inventory resolves memory slugs to paths), otherwise
  `~/.agent-instructions/parked.md` with provenance (file, line, date) —
  `render.js --parked <file>` stages the new parked.md.

From auto memory:
- cross-project preference → master (Communication / Workflow / …);
- stable project fact → that project's canon; project-specific notes found by
  the *global* skill are only counted ("project X: N notes → run
  instructions-project there");
- machine-specific fact (local path, version, port, absolute path under home) →
  stays in memory or is archived; **never enters a git-tracked canon**.

After a MOVE out of memory the line is removed from the memory file (dedupe;
`render.js --memory-edits <json>` stages the rewritten file); frontmatter lines
are structure and stay. Memory lines that stay get `KEEP` with the reason
("machine-specific", "project fact — counted for X"), so the counts are
complete. A memory file whose body is empty after the MOVEs is *superseded*:
archive it and drop its line from `MEMORY.md` (rewrite the index with
`--memory-edits` too; the index has no frontmatter). The secret value of a
`DROP:SECRET` line never appears in chat or in the report; it does remain in
the run dir's `diff/` and backups under the user's home — say so in the warning.

FLAG lines stay in the proposal text until the user answers — a FLAG is a
question, not a removal. Mark them in place with a trailing HTML comment
`<!-- FLAG: <batch> -->` so they are easy to find; when the answer comes,
relabel, remove the comment and re-render. The losing side of a conflict the
user resolved becomes `DROP:STALE` with the evidence "user chose <line> (run
<id>)".

Batch names (use these; add a new one only when none fits): `DEFAULT` (drop as
default behaviour?), `CONFLICT` (two lines contradict), `STALE` (looks
outdated, no hard evidence), `OVERRIDE` (Codex `AGENTS.override.md` content),
`PERSONAL` (personal line in a shared repository), `KARPATHY` (block edited by
hand / upstream moved), `SCOPE` (unclear whether global or project).

## Section templates

Headings only; an existing sane structure is preserved. The template guides
where new lines go and the "where is this already said?" check.

- Master: Communication · Workflow · Code · Environment & tools · Safety ·
  Karpathy guidelines (+ Local additions).
- Project canon (`AGENTS.md`): About · Commands · Conventions · Architecture
  notes · Safety.

## Calibration examples (expected labels)

1. "Always run `npm test` after modifying JavaScript files." → KEEP.
2. "Write clean, maintainable code." → DROP:VAGUE.
3. "Use meaningful variable names." → FLAG (batch DEFAULT).
4. "Never force-push to main." → KEEP; wording never softened.
5. "Never push to main without asking." + "Do not push to main." → MERGE into
   the stricter line; keep "never".
6. Global "Prefer pnpm over npm." vs project "This repo uses npm; do not use
   pnpm." → not a duplicate; project line KEEP (project overrides global).
7. In the global file: "For the foo-service repo, run `make dev` before tests."
   → MOVE → foo-service canon if present on this machine, else parked.
8. "Don't add features beyond what was asked." → DROP:KARPATHY (§2 Simplicity First).
9. "Don't add features beyond what was asked; in particular never add npm
   dependencies without asking." → the delta "In addition to Karpathy §2: never
   add dependencies without asking." → Local additions.
10. "OpenAI key: sk-…" → DROP:SECRET + warning.
11. Memory: "Use /opt/homebrew/bin/python3.11 for scripts." → machine-specific →
    stays in memory or archive; never into a git-tracked canon.
12. Memory: "User prefers short answers without preamble." → MOVE → master (Communication).
13. Memory of project X: "Tests: `pytest -q`; DB tests need `docker compose up
    db`." → MOVE → project X canon (Commands), then remove from memory.
14. "Build with `scripts/old-build.sh`." and the file does not exist →
    DROP:STALE with evidence "path not found"; if it exists → KEEP.
15. A non-English line meaning "Answer briefly." → REWORD "Answer briefly."; if
    "User prefers short answers" already exists → MERGE into it.
16. "Run `npm run lint` before committing." → KEEP, section Commands (a rule
    that carries a command goes where the commands are; Conventions is for
    rules without one).

## labels.json

The model records every label in `runs/<run-id>/labels.json` so `report.js`
can count and list them:

```json
{ "entries": [
  { "file": "~/.claude/CLAUDE.md", "line": 12, "text": "Write clean, maintainable code.",
    "label": "DROP:VAGUE", "reason": "no behaviour change, no specifics" },
  { "file": "~/.claude/CLAUDE.md", "line": 14, "text": "Use meaningful variable names.",
    "label": "FLAG", "batch": "DEFAULT", "reason": "default agent behaviour — drop?" },
  { "file": "~/.codex/AGENTS.md", "line": 3, "text": "Antworte kurz.",
    "label": "REWORD", "after": "Answer briefly." },
  { "file": "~/.claude/CLAUDE.md", "line": 20, "text": "For foo-service run make dev first.",
    "label": "MOVE", "to": "~/Workspace/foo-service/AGENTS.md (Commands)" }
] }
```
