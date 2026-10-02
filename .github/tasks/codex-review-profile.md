# Codex review profile and preflight in `review-pr-duo` (#46)

## Goal
The Codex reviewer runs on a model the user chose for reviews, the user is told
which model that is, and a model Codex cannot use is reported before anything is
dispatched instead of after the Claude side has already started.

## Facts checked on Codex 0.153.4
- `codex exec -p <name>` layers `$CODEX_HOME/<name>.config.toml` over the base config.
- A missing profile file is not an error: Codex silently runs on the base config.
  The skill has to test for the file itself.
- A minimal `codex exec` prints `model:` and `reasoning effort:` in its header and
  exits non-zero with the API error when the model is refused (~8k tokens, a few seconds).

## Decisions
- Profile name → `ali-review`, file `${CODEX_HOME:-$HOME/.codex}/ali-review.config.toml`.
- Profile file absent → one line saying so, then run on the top-level model as today.
- Preflight → `echo "Reply with the single word OK." | codex exec [-p ali-review] -s read-only -`,
  run before either dispatch; on failure print the error in one line and run the
  Claude side alone, like the existing PATH check.
- Model shown to the user → read from the preflight header, not assumed.

## Steps
- [x] 1. `review-pr-duo` step 2: profile check, preflight, `-p ali-review` on the
  dispatch command, the reviewers line names Codex's model, effort and source;
  drop "do not override them" — files: `skills/review-pr-duo/SKILL.md` — done when:
  step 2 orders PATH check → profile check → preflight → Codex → Claude, and
  `npm run check` is green
- [x] 2. `review-pr-duo` step 3: the Codex verdict is labelled with the model from
  the preflight — files: `skills/review-pr-duo/SKILL.md` — done when: step 3 names it
- [x] 3. Document the profile file with a minimal example — files: `README.md` —
  done when: the duo row or a setup note shows the file path and its two keys, and
  `npm run check` is green
