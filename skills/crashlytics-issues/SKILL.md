---
name: crashlytics-issues
description: Import Firebase Crashlytics issues into the repository's GitHub issue tracker, one selected batch at a time, without ever filing a duplicate. Use when the user asks to turn crashes into issues, to triage Crashlytics, or runs /ali-crashlytics-issues.
---

# Turn Crashlytics issues into GitHub issues

Manual import. The skill gathers the current top crashes, checks each one against the code as it
stands today, shows them next to what is already filed, and lets the user pick. It never files
anything the user did not select.

**Scope: Android apps, GitHub issues.** The app is identified through `google-services.json`,
and ANR handling and stack-trace reading both assume an Android build. An iOS or web app registered
in the same Firebase project needs step 2 taught about `GoogleService-Info.plist` first — say so and
stop rather than guessing.

Arguments (all optional): `--days N` (default 7), `--include-non-fatal`, `--app-id <firebase app id>`.

## 1. Check the prerequisites

- Firebase MCP tools `crashlytics_get_report` and `crashlytics_list_events` must be available.
  They are the only way in: Crashlytics has no public REST API. If they are missing, stop and tell
  the user to install the Firebase MCP plugin — do not improvise a substitute.
  (`crashlytics_get_issue` is not needed for an import — the report and the sample event carry
  everything the issue body uses. Reach for it only when a candidate needs digging into.)
- `gh auth status` must succeed and `gh repo view --json nameWithOwner` must resolve.
  Without a GitHub remote there is nowhere to file.

## 2. Resolve the apps

Sources, in order, stopping at the first that answers:

1. `--app-id` from the arguments — one app, and that is the whole set.
2. `google-services.json` in the working tree (`find . -name google-services.json -not -path '*/build/*'`):
   `client[].client_info.mobilesdk_app_id`, plus `project_info.project_id` and
   `client[].client_info.android_client_info.package_name` for the console links in step 7.
3. `firebase_list_apps`.

A project usually registers several apps — paid and free editions, staging copies, and ones it
stopped shipping years ago. **Query every app the project still builds and merge the results into
one table**; reporting them separately hides that the same crash hits all of them. An app is still
built when the current build configuration produces it — a package name that appears nowhere in the
build files is a leftover registration, so skip it. Say in one line which apps were queried and
which were skipped, and ask the user only when a package's status is genuinely unclear.

## 3. Fetch the candidates

- `crashlytics_get_report` with `report: "topIssues"`, `pageSize: 20`, and a filter of
  `intervalStartTime` = now minus `--days`, `intervalEndTime` = now. Omitting the interval means the
  last 7 days, which is the default anyway.
- `issueErrorTypes`: `["FATAL", "ANR"]`, or `["FATAL", "ANR", "NON_FATAL"]` with `--include-non-fatal`.
  Non-fatals are noisy and rarely worth a ticket on their own.

The report carries the console `uri` for each issue — keep it, it is better than one built by hand.

## 4. Find what is already filed

```sh
gh issue list --state all --limit 200 --json number,title,body,state,url,labels
```

Filter for a body containing `crashlytics-id: <issueId>`. Match on that marker only — titles drift,
the id does not. Do **not** pass `--label crashlytics`: on a repository where nothing has been
imported yet the label does not exist and `gh` fails on the unknown label rather than returning an
empty list.

**Then look in the comments too.** A crash that shares a root cause with one already filed belongs
as a comment on that issue rather than as a second issue, and the marker goes into the comment — so
a body-only scan will offer it again on the next run. For every issue that carries the `crashlytics`
label, read `gh issue view <number> --json comments` and match the marker there as well. That is a
handful of calls while the label is young; once the repository has imported dozens of crashes,
switch to one `gh search issues "crashlytics-id" --repo <owner/repo> --json number,body` instead of
walking them one by one.

## 5. Check each candidate against the code as it stands

Before showing the table, for every candidate with a frame the project owns — fetch its sample
event first (`crashlytics_list_events`, `pageSize: 1`, `filter.issueId`), the checks below read it:

- Open the blamed frame in the working tree. Crash reports come from a released version, so line
  numbers drift and the method may have been renamed or deleted.
- If the code around it has changed, find out whether the fix reached the users who crashed.
  `git log -S "<distinctive string from the fix>" -- <file>` gives the fix commit. Compare it
  against **the revision that actually crashed**, which the sample event carries in
  `buildStamp.repositories.revision`:
  `git merge-base --is-ancestor <fix commit> <crashed revision>`.
- Prefer that revision over a release tag. A tag records what someone meant to release; the build
  stamp records what ran on the device, and the two drift whenever a build is cut past the tag.
  Fall back to the tag only when the event has no build stamp, and then say in the verdict that the
  released version was inferred from a tag and may lag behind it.
- If `git cat-file -t <revision>` does not find the revision, the local clone does not have it
  (shallow clone, force-push, a build from a fork). Say the crashed revision is unknown locally
  rather than silently falling back to a comparison that means something else.
- Record the verdict per candidate: unfixed / fixed but unreleased / fixed and released / partly
  fixed. "Partly fixed" is the interesting one — a crash whose exception type changed but which
  still takes the app down is still a crash.

This step is what keeps the tracker honest. A report filed as if nothing had been done invites a
second fix of something already fixed.

## 6. Show the table and ask

Most impactful first, one row per Crashlytics issue:

| # | Issue | Type | Events | Users | Versions | App | Filed | Code today |
|---|-------|------|--------|-------|----------|-----|-------|------------|
| 1 | `NullPointerException` in `WalletFragment.onBind` | FATAL | 142 | 37 | 2.4.1, 2.4.0 | free + paid | — | fixed, unreleased |
| 2 | `IllegalStateException` in `BackupWorker.run` | FATAL | 9 | 2 | 2.4.1 | paid | #61 (open) | unfixed |
| 3 | `TimeoutException` in `BackupWorker.run` | ANR | 4 | 2 | 2.4.1 | paid | #61 (comment) | unfixed |

`Filed` says where the marker was found: `#61 (open)` for an issue of its own, `#61 (comment)` for a
crash recorded on someone else's issue as a shared root cause. Both are filed and both stay out of
`all`; the reader needs to see which is which.

Then ask which rows to import: numbers, `all`, or nothing. Rows already filed are excluded from
`all`; import one again only if the user names its number, and say plainly that it will be a second
issue for a crash that already has one.

## 7. File the selected ones

For each row the user picked:

- Reuse the sample event already fetched in step 5. Fetch one now (`crashlytics_list_events`,
  `pageSize: 1`, `filter.issueId`) only for a candidate step 5 skipped — one whose frames all belong
  to the framework or a library.
- Title: `<Exception type> in <top app frame>` — the frame from the package the app owns, not
  the framework frame at the top of the trace — followed by a short clause naming the user-visible
  effect.
- Body:

  ````markdown
  **Crashlytics:** <issue title>
  **Type:** FATAL | ANR | NON_FATAL
  **Impact (last N days):** <events> events, <users> users — <which flavour>
  **Versions:** first seen <x>, last seen <y>
  **Console:** <uri from the report>

  <what actually breaks, in plain language>

  ### Current state of the code

  <the verdict from step 5, with the commit and the release it did or did not make>

  ### Stack trace (sample event, <date>, <device>, <os>)

  ```text
  <trace, framework noise trimmed>
  ```

  crashlytics-id: <issueId>
  ````

- `gh issue create --title … --body-file <tmp> --label crashlytics`. Create the label first with
  `gh label create crashlytics --color B60205 --description "Imported from Firebase Crashlytics"`
  if `gh label list` does not have it. Write the body through a file, never inline: a stack trace
  on a command line gets mangled by the shell.

A candidate that shares its root cause with an issue already filed goes in as a **comment on that
issue**, not as a new one: same body shape, ending with its own `crashlytics-id:` marker, plus a
line on why it is the same cause. Two issues for one bug get fixed once and closed twice.

Never rewrite the body of an existing issue and never close one here. This skill only adds — a new
issue, or a comment on an existing one.

## 8. Report

List what was created with its URL, and name what was skipped and why (already filed, not
selected). Surface any step-5 verdict that changes what the user should do next — a crash already
fixed but unreleased, or two issues that share one root cause. If nothing was created, say that in
one line rather than padding the report.
