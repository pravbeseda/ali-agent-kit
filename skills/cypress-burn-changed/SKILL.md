---
name: cypress-burn-changed
description: Burn the cypress tests changed on the current branch — run each changed `it` headless N times in a row and produce a screenshot of the (Results) box of every run. Use when the user asks to check new or edited cypress tests for flakiness, to run changed tests with repeats, or runs /ali-cypress-burn-changed.
---

# Burning the changed cypress tests

The work is done by `scripts/burn-changed-tests.mjs`, which ships with this skill. It has to run from
the project's `testing/Cypress/scripts/` — it imports the project's helpers next to it and finds the
cypress dir from its own path — so it is never run from here. `scripts/run.mjs` puts a copy there for
one run and removes it on every way out. Drive the wrapper; do not copy the script by hand and do not
re-implement its steps.

## Run it

`<skill>` below is the absolute path of the directory holding this file. Run from anywhere inside the
target repository:

```bash
node <skill>/scripts/run.mjs --dry-run          # which tests would be burned
node <skill>/scripts/run.mjs --burn 20          # burn them, 20 runs each
```

Every flag goes to the script unchanged: `--base <ref>` (default: base of the branch's open PR, else
the default branch of `origin`, else `origin/develop`), `--burn <n>` (default 20),
`--app <app:branding>` (default `uc:default`), `--retries <n>` (default 0), `--all`, `--only <text>`,
`--out <dir>`, `--dry-run`. `--help` prints the same list.

The wrapper exits with the script's code (1 = some run failed), 130 / 143 after Ctrl-C / SIGTERM, and
**2 when it refused to start** — it says why and has copied nothing:

- not inside a git repository, or the repository has no `testing/Cypress/scripts/` — this is not a
  project the script serves; say so and stop;
- `testing/Cypress/scripts/burn-changed-tests.mjs` is **a copy left there by this skill** — every copy
  opens with a comment saying so. Either another burn is still running in this checkout (wait for it,
  or check for one of yours in the background), or a run was killed with no chance to clean up. Once
  no burn is running, that file is safe to delete; say so and offer to.
- `testing/Cypress/scripts/burn-changed-tests.mjs` **already exists and is not ours** — the project
  has its own copy now (or a file of that name). The wrapper never overwrites or deletes it. Tell the
  user, and offer to run the project's copy directly:
  `cd testing/Cypress && node ./scripts/burn-changed-tests.mjs …`.

The copy is removed even when the run is stopped — Ctrl-C, SIGTERM, a closed terminal — so nothing
needs adding to `.gitignore` and nothing can be committed by accident. Only `kill -9` leaves it behind,
and the next run names it as above. Do not delete a copy while its run is going.

## How to use it in a session

1. Always start with `--dry-run` and show the user the list of tests it found. A branch that
   touched a spec's shared helpers (`beforeEach`, fixtures at the top of the file) produces a
   warning instead of extra tests — offer `--all` when that warning appears.
2. Agree on the repeat count before a long run. 20 runs of one test take tens of minutes;
   the script runs the tests one after another, so multiply by the number of tests and say
   that estimate out loud before starting.
3. Start the run in the background (`run_in_background`) and do not pipe it through `tail` —
   piping hides the progress until the run ends. Read the task output file instead.
4. When it finishes, report per test how many of N runs passed, and the absolute path of the
   output folder with the `.png` files — the `Screenshots:` line of the summary
   (`testing/Cypress/results/burn/<timestamp>` unless `--out` was given).
5. The summary ends with the tests that did not pass every run and a ready-made command that
   burns only those. It is printed as `node ./scripts/burn-changed-tests.mjs <flags>`, a path that
   no longer exists once the run is over: hand the user the same flags behind
   `node <skill>/scripts/run.mjs` instead of composing a command yourself. `--only` is repeatable
   and matches on a part of the title.
6. A failure never stops the batch. For the reason behind one, look at cypress' own screenshots in
   `testing/Cypress/screenshots/<branding>/<spec>/<test> burning <k> of <n> (failed).png`, and at
   the `<nn>-<slug>.log` the script writes when a run produced no results box at all.

## What it does, so you can explain it

- Diffs the working tree against the merge-base with the base, collects the changed `*.spec.ts`
  files (untracked ones count as entirely new) and maps changed lines onto the enclosing `it`.
- Runs `yarn cypress run --spec <spec>` once per test with `CYPRESS_grep=<title>`,
  `CYPRESS_burn=<n>` and `--env grepOmitFiltered=true`, so exactly one `it` runs, `--burn` times,
  and the other tests of the spec stay out of the table. Env vars are used for the title and the
  count on purpose: a title holding a comma breaks the `--env "grep=…,burn=…"` form.
- Warns when a run made a different number of attempts than `--burn` — that means the title is a
  substring of another test's title, and the two have to be burned separately with `--only`.
- `--retries 0` by default, so a flaky attempt shows up as a failure instead of being retried away.
- Serves `targets/origin/web/dist/<branding>` itself when nothing answers on the app's baseUrl,
  and reuses an already running `yarn start:web` when something does. A missing dist is a hard
  error — the user has to build first.
- Writes `<nn>-<slug>.png` per test into `results/burn/<timestamp>/` (gitignored): the
  `(Results)` box rendered by headless Chrome, captioned with the test title and the repeat
  count — that is the artifact to attach to a PR or a Jira ticket. A run that produced no box
  leaves `<nn>-<slug>.log` with its whole output instead.
- Chromium log lines (`[1234:0921/151703.594311:ERROR:…]`) from the browsers cypress launches are
  filtered out of the console.
- Its runtime imports — `minimist` and the sibling helpers — resolve from the target project, so
  the project has to have its dependencies installed.

## Gotchas

- Tests that need a dist the branch did not rebuild will fail for the wrong reason. If every
  run fails identically, suspect a stale `targets/origin/web/dist` before suspecting the test.
- A renamed test only exists on one side of the diff; the script burns the current title.
- Headless Chrome writes the PNG and then keeps running; the script kills it once the file stops
  growing. A run that seems stuck right after a spec finished is that, not cypress.
