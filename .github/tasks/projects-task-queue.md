# One cross-repo task queue on GitHub Projects

## Goal
One GitHub Project holds every open issue of the user's 21 repositories, ordered by an
explicit priority, so the user sees what is next at a glance and an agent started in any
repository can take the next task with one command.

## Decisions
- Tool → GitHub Projects (v2) over issues; agents are still launched by the user in cmux.
  Agent-launching boards and cloud agents can be layered on later without moving the queue.
- Scope → one user-level project named `Work` for all 21 repositories of `pravbeseda`,
  including the four without open issues today.
- Content → every open issue, not only the ones added on purpose; untriaged ones wait in `Inbox`.
- Order → a `Priority` field (P0–P3), not the manual card position, because `gh` reads a
  field reliably and the position poorly.
- Board updates → only through skills; ordinary sessions never touch the board.
- Triage → on demand with `/ali-triage`; a scheduled reminder only if `Inbox` turns out to pile up.
- Epics → a parent issue with sub-issues; dependencies → native "blocked by" links. Both work
  across repositories. A cross-repo epic lives in the repository that holds its plan file.
- Existing issues are all flat, but some depend on each other → the first triage also proposes
  "blocked by" links and epic groupings between them.

## Model
- `Status`: `Inbox` → `Ready` → `In progress` → `In review` → `Done`.
- `Priority`: P0, P1, P2, P3. `Kind`: bug, feature, chore (a project field named `Kind` because `Type` is reserved for native issue types, which exist only in organisations; the repositories are
  personal). `Size`: S, M, L.
- Views (made by hand in the web UI, the API cannot create them):
  `Queue` — table, `status:Ready`, sorted by Priority; `Board` — board by Status;
  `By repo` — table grouped by Repository; `Epics` — table grouped by Parent issue, with
  Sub-issues progress.
- Built-in workflows: item added → `Inbox`, item closed → `Done`, pull request merged → `Done`.

## Steps
- [x] 1. Prerequisite — the user runs `gh auth refresh -s project` — done when: `gh auth status` lists the `project` scope
- [ ] 2. Create the project and its fields with `gh project create` / `gh project field-create`, rename the default Status options to the five above; the user adds the four views and enables the two workflows — files: none (one-off commands) — done when: `gh project field-list` shows all four fields with the listed options and the views exist
- [ ] 3. Skill `triage`: (a) add every open issue of the owner's repositories that is not yet on the project with `Status: Inbox`; (b) propose Priority, Kind, Size or "close" for every `Inbox` item as one table, plus "blocked by" links (any repository, each with a one-line reason) and epic groupings — read from the issue texts and, where they are unclear, from the code; (c) apply what the user confirms — fields, links via `issues/{n}/dependencies/blocked_by`, parents via `issues/{n}/sub_issues` — and move the kept items to `Ready` — files: `skills/triage/SKILL.md`, README skill list — done when: `npm run check` is green and a dry run on the real project prints the table
- [ ] 4. Skill `next-task`: take the top `Ready` item of the current repository by Priority, skipping items with an open blocker and items that have sub-issues (epics are containers), or the issue given as `#N`; set it `In progress`; work on a branch, in a git worktree when the checkout is busy (dirty tree or another task's branch); when this session opens the PR, put `Closes #N` in its body and set the item `In review` — files: `skills/next-task/SKILL.md`, README skill list — done when: `npm run check` is green and a run in a test repository moves a card through `In progress` to `In review`
- [ ] 5. First triage of the ~97 existing issues with `/ali-triage`, including their dependencies — done when: `Inbox` is empty

## Rulings
- New issues are put on the board by `triage`'s sweep (step 3a), not by every skill that files
  issues: one place to maintain, and issues filed by hand or by non-kit skills are not lost.
- Skills find the project by its title `Work` under the authenticated user; no config file.
- No claim lock: two agents in the same repository started seconds apart may pick the same
  item. The user passes `#N` explicitly in that case.

## Parked
- Local folders without a GitHub repository (`LAB`, `drawerApp`, `SpendControlNS`, `WatchFaces`)
  can only appear as draft items; out of scope until one of them gets a repository.
