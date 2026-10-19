---
name: next-task
description: Take the next task for the current repository from the user's `Work` GitHub Project — the top `Ready` issue by priority that nothing blocks, or the issue the user named — mark it `In progress`, set up a branch or worktree, work on it, and mark it `In review` when this session opens its pull request. Use when the user asks for the next task, what to work on, to take an issue from the board, or runs /ali-next-task.
---

# Take the next task

The `Work` GitHub Project, owned by the authenticated user, is the queue for all their repositories; `ali-triage` fills and orders it. This skill takes one item off it for the repository the session runs in and keeps the board honest about it: `Ready` → `In progress` when the work starts, `In review` when the pull request opens. The project's own workflows move it to `Done` on merge or close.

> **Not `ali-triage`:** that skill sorts the queue. This one consumes it and never reorders it.

**Invoking this skill grants nothing else.** Commits, pushes and pull requests follow the user's and the repository's usual rules; the skill only adds the two board moves.

## 1. Resolve the repository and the project

```sh
gh repo view --json name,nameWithOwner,defaultBranchRef --jq '{repo: .nameWithOwner, name: .name, base: .defaultBranchRef.name}'
gh api user --jq .login
gh project list --owner @me --limit 1000 --format json --jq '.projects[] | select(.title == "Work") | {number, id}'
gh project field-list {number} --owner @me --format json
```

Keep the project number and id and the ids of the `Status` field and its `In progress`, `In review`, `Ready` and `Inbox` options. No `project` scope on `gh` → stop and tell the user to run `gh auth refresh -h github.com -s project` in their own terminal. No `Work` project, a `Status` field without those four options, or a `Priority` field without `P0`–`P3` → stop, name what is missing and point at [Task queue setup](https://github.com/pravbeseda/ali-agent-kit#task-queue-setup).

## 2. Pick the item

Page through the whole board; a truncated list can hide the top item:

```sh
gh api graphql -f query='
query($login: String!, $number: Int!, $cursor: String) {
  user(login: $login) { projectV2(number: $number) { items(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id
      status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
      priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
      content { ... on Issue { number title state url repository { nameWithOwner }
        parent { number repository { nameWithOwner } }
        subIssuesSummary { total }
        issueDependenciesSummary { blockedBy } } } } } } } }' \
  -F login={login} -F number={number}
```

While `pageInfo.hasNextPage`, repeat with `-F cursor={endCursor}`.

**The user named an issue** (`#N` or a URL) → take that one, whatever its `Status`. It must belong to the current repository — the branch and the work happen here; one from another repository stops the run with the name of the repository to start it in. If it is not on the board, add it with `gh project item-add {number} --owner @me --url {url} --format json --jq .id`. If it is closed, say so and stop. If it is `In progress` or `In review`, somebody already has it: say so and ask once whether to take it anyway. If it has open blockers or sub-issues, list them and ask once whether to go ahead anyway — the user may know something the board does not.

**Otherwise** the candidates are the items that are all of:

- `Status` is `Ready`,
- an open issue of the current repository,
- `issueDependenciesSummary.blockedBy` is `0` — it counts open blockers only, so a closed blocker no longer blocks,
- no sub-issues — an epic is a container; its parts are the tasks.

Take the highest priority — P0 first, an empty priority last — and among equals the lowest issue number, the oldest. Nothing left → say the queue for this repository is empty, name how many items of it wait in `Inbox` or are blocked, and stop; point at `ali-triage` when `Inbox` is not empty.

## 3. Claim it

For an item step 2 picked from the queue, re-read its `Status` just before writing — one item, not the whole board:

```sh
gh api graphql -f query='query($id: ID!) { node(id: $id) { ... on ProjectV2Item { status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }' -F id={itemId}
```

Another agent may have taken it seconds ago: if it is no longer `Ready`, go back to step 2 and take the next one. A named issue skips this re-check — step 2 already settled its status with the user. Either way, remember the `Status` the item had before this write — an empty one counts as `Inbox` — because step 6 may need to put it back.

```sh
gh project item-edit --project-id {projectId} --id {itemId} --field-id {statusFieldId} --single-select-option-id {inProgressOptionId}
```

There is no lock behind this — two agents started in the same repository at the same moment can still collide. That is why the user passes `#N` explicitly when they start several at once.

## 4. Set up where the work happens

**A task taken from `In progress` may already have its place.** An earlier session that ended without a PR left its branch, and maybe a worktree, behind. Look first:

```sh
git worktree list
git branch --all --list '*{N}*'
```

One worktree that plainly belongs to this issue → work in it. One such branch without a worktree → the busy-checkout rule below still applies: only on a clean tree on the base branch `git switch {branch}`, otherwise — uncommitted changes, or another task's branch checked out — `git worktree add ../{name}-{N} {branch}`, so no other task's checkout is moved or carried along. Say which. Several candidates → ask the user which one. Only with nothing found does the issue get a new branch below.

```sh
git status --porcelain
git rev-parse --abbrev-ref HEAD
git fetch origin {base}
```

Either way the branch starts from `origin/{base}`, not from the local `{base}`: commits on the local base branch that were never pushed belong to other work and stay out of this task.

- **Clean tree on the base branch** → create the working branch here: `git switch --no-track -c {branch} origin/{base}`.
- **Anything else** — uncommitted changes, or another task's branch checked out — → this checkout belongs to other work. Leave it untouched and create a worktree next to it, then work in that directory from here on and tell the user its path:

  ```sh
  git worktree add --no-track -b {branch} ../{name}-{N} origin/{base}
  ```

Name the branch the way the repository already names them (look at `AGENTS.md`, `CONTRIBUTING.md` or recent branches), with the issue number always in it — `feat/{N}-{short-slug}`, not `feat/{short-slug}` — because the lookup above finds an earlier session's branch only by that number; with no convention, `{N}-{short-slug}`.

## 5. Brief, then work

Before touching code, show in a few lines: the issue's number, title and link; its parent epic and that epic's plan file, if the epic body or the repository's plan folder names one; where the work happens. Read the plan file when there is one — it carries the reasons the issue does not.

Then do the task the way the user and the repository normally work.

## 6. Hand it back to the board

- **This session opens the pull request** → its body carries `Closes #{N}`, and the item moves to `In review`:

  ```sh
  gh project item-edit --project-id {projectId} --id {itemId} --field-id {statusFieldId} --single-select-option-id {inReviewOptionId}
  ```

- **The user drops the task** → move it back to the `Status` it had before step 3 — `Inbox` stays `Inbox`, so an untriaged issue never lands in the queue — and say so.
- **The session ends without a PR** → leave it `In progress` and say that it is, so the board is not silently stale.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Anything that reaches GitHub or git — always English.

## Extra context

If the user passed an issue number or URL with the invocation, that is the task to take. It arrives below; an empty line there means no arguments were given.

$ARGUMENTS
