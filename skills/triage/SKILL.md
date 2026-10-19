---
name: triage
description: Sort the user's cross-repo task queue — put every open issue of their repositories on the `Work` GitHub Project, then propose priority, kind, size, "blocked by" links and epic groupings for everything in `Inbox`, and apply only what the user confirms. Use when the user asks to triage, sort or prioritise their issues or the board, or runs /ali-triage.
---

# Triage the task queue

One GitHub Project, `Work`, owned by the authenticated user, holds the open issues of all their repositories. Untriaged items sit in `Inbox`; triaged ones wait in `Ready`, ordered by `Priority`, for `ali-next-task` to pick up. This skill moves items from the first to the second.

> **Not `ali-next-task`:** that skill takes one `Ready` item and works on it. This one only sorts; it never starts work on an issue.

**Nothing changes on GitHub without the user's confirmation, except step 2.** Adding a missing issue to `Inbox` is lossless and is the point of the run; every field, link, new epic and closed issue waits for the user's word in step 5.

## 1. Resolve the project

```sh
gh api user --jq .login
gh project list --owner @me --limit 1000 --format json --jq '.projects[] | select(.title == "Work") | {number, id}'
gh project field-list {number} --owner @me --format json
```

- `gh` must carry the `project` scope. Without it, stop and tell the user to run `gh auth refresh -h github.com -s project` in their own terminal — it is interactive.
- No project titled `Work` → stop, say so and point at [Task queue setup](https://github.com/pravbeseda/ali-agent-kit#task-queue-setup); do not create one.
- **Check the fields before anything is written**: `Status` with `Inbox`, `Ready`, `In progress`, `In review`, `Done`; `Priority` with `P0`–`P3`; `Kind` with `bug`, `feature`, `chore`; `Size` with `S`, `M`, `L`. Anything missing → stop, name each missing field or option, and point at the same section. A write that fails halfway through step 2 is worse than a run that never started.
- Keep the project number and id and the ids of those fields and options. Every later write needs them.

## 2. Sweep missing issues into `Inbox`

```sh
gh search issues --owner {login} --state open --archived=false --limit 1000 --json url,repository,number,title
```

Run the step 3 query first, compare by URL against the issues already on the board, and add each missing one:

```sh
gh project item-add {number} --owner @me --url {url} --format json --jq .id
gh project item-edit --project-id {projectId} --id {itemId} --field-id {statusFieldId} --single-select-option-id {inboxOptionId}
```

Set `Inbox` explicitly even though the project's *Item added* workflow may do the same: the workflow can be off or point at a renamed option. An item already on the board with an empty `Status` counts as `Inbox` too.

Say how many issues were added, per repository.

## 3. Read the board

Page through every item; a truncated list looks exactly like a short queue:

```sh
gh api graphql -f query='
query($login: String!, $number: Int!, $cursor: String) {
  user(login: $login) { projectV2(number: $number) { items(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { id
      status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
      priority: fieldValueByName(name: "Priority") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
      content { ... on Issue { number title state url body repository { nameWithOwner }
        parent { number repository { nameWithOwner } }
        subIssuesSummary { total completed }
        blockedBy(first: 20) { nodes { number state repository { nameWithOwner } } } } } } } } } }' \
  -F login={login} -F number={number}
```

While `pageInfo.hasNextPage`, repeat with `-F cursor={endCursor}`.

The candidates are the `Inbox` items whose issue is still open. `Ready` items are context: a new item's priority is relative to what already waits, and a dependency may point at one of them.

If the user passed a repository or a group of repositories, triage only those; the rest of `Inbox` stays as it is.

## 4. Work out a proposal

For every candidate decide:

| Column | Values | Meaning |
| --- | --- | --- |
| Priority | P0–P3 | P0 broken now or blocking users; P1 next up; P2 soon; P3 someday |
| Kind | bug / feature / chore | what the work is |
| Size | S / M / L | S an agent can finish unattended; M needs a look at the result; L needs a plan first |
| Blocked by | issue refs | other issues, in any repository, that must be done first — each with a one-line reason |
| Epic | parent ref or new epic | only when several issues are parts of one outcome |
| Close | reason | duplicate, already done, or obsolete — with the evidence |

- **Read the issue text first; open the code only where the text leaves the answer open** — for example, to check whether a bug is already fixed or whether two issues touch the same module. This is a sorting pass, not an investigation.
- **Dependencies are the part people cannot see from a list.** Look for them across repositories that share a domain: a client issue waiting for an API change, a migration that must land before a feature. Propose a link only with a concrete reason; "related" is not "blocked by".
- **Keep the links that already exist.** Show them in the table so the user sees the chains; propose removing one only when the blocker is closed or wrong.
- **An epic is a container, not a task.** Propose one only for three or more issues that make sense only together. A cross-repo epic goes into the repository that holds its plan file, or the one that carries the final user-visible change when there is no plan.
- **Close only on evidence** — the duplicate's number, the commit that fixed it, the feature that no longer exists.

## 5. Show it and collect the decisions

Present one table per group of related repositories — a product family together, infrastructure together, the rest last — at most about 25 rows each, P0 first:

```
| # | Issue | Title | Priority | Kind | Size | Blocked by | Epic | Close |
```

The user answers in short form — `ok`, `ok except 3 P1`, `5 not blocked`, `drop 7` — and may change any cell. Ask nothing else; the table is the question. Go through the groups one at a time and apply each group once it is confirmed, so a long pass loses nothing if it is interrupted.

## 6. Apply what was confirmed

- **Fields:** `gh project item-edit` with the field and option ids from step 1, one call per field.
- **Blocked by:** REST takes the blocker's database id, not its number. The two issues may live in different repositories, so each command names its own:

  ```sh
  gh api repos/{blockerRepo}/issues/{blocker} --jq .id
  gh api -X POST repos/{blockedRepo}/issues/{blocked}/dependencies/blocked_by -F issue_id={blockerId}
  ```

  Removing one: `gh api -X DELETE repos/{blockedRepo}/issues/{blocked}/dependencies/blocked_by/{blockerId}`.
- **New epic:** `gh issue create` in the chosen repository, English title and a body listing its parts; add it to the board; then attach each part by the part's database id, read from the part's own repository:

  ```sh
  gh api repos/{partRepo}/issues/{part} --jq .id
  gh api -X POST repos/{epicRepo}/issues/{epic}/sub_issues -F sub_issue_id={partId}
  ```

- **Close:** `gh issue close {url} --reason "not planned" --comment "{evidence}"`; `--reason duplicate` for a duplicate, with the original in the comment; `--reason completed` when it is already done.
- **Status:** a kept item moves to `Ready` last, and only once every other write for it succeeded. Epics too — `ali-next-task` skips containers on its own.

A failed write is reported with `gh`'s message and the item it was for, and the run goes on with the other items; the item itself stays in `Inbox`, so a half-triaged task never reaches the queue. At the end list the failures together.

## 7. Close the pass

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Triage — {n} added to Inbox, {n} triaged
Ready: {n} (P0 {n} · P1 {n} · P2 {n} · P3 {n}), {n} blocked
Closed: {n} · Epics created: {n} · Links added: {n}
Left in Inbox: {n}
Board: {project url}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Then the failed writes, if any.

## Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Anything that reaches GitHub — issue titles, bodies, comments — always English.

## Extra context

If the user passed anything with the invocation — a repository, a group of repositories, a limit — treat it as the scope of this pass. It arrives below; an empty line there means no arguments were given.

$ARGUMENTS
