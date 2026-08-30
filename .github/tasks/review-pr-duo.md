# ali-review-pr-duo

## Goal

One command in a Claude Code session that reviews a pull request twice — with
Claude Opus and with Codex `gpt-5.6-sol` at high reasoning effort — in two clean
contexts, waits for both, and then hands the resulting threads to
`ali-process-pr-comments`. Today that means opening a second session by hand and
remembering to come back.

`ali-review-pr` and `ali-review-branch` stay agent-independent: neither of them
learns anything about subagents. The new skill only dispatches.

## Decisions

- **Where it lives** → a skill in this repo, not a personal `~/.claude/commands`
  file, because it is used across projects and should install from npm.
- **Which hosts** → Claude Code only. Copilot CLI has no subagent primitive (and
  no binary in this machine's PATH), so a Copilot copy would be dead weight.
- **How that is expressed** → an `agents:` key in the source frontmatter, checked
  against the adapter registry and stripped before the skill is written. Rejected:
  a sidecar metadata file (a second metadata channel next to `agents/openai.yaml`),
  and an adapter capability vocabulary (`requires: subagents`) — the real
  requirement is a named host, and a vocabulary that says "Codex has no subagents"
  would be false.
- **Duplicate findings** → accepted, not deduplicated. Two reviewers running in
  parallel cannot see each other, so the same line can collect two 🤖 comments.
  `ali-process-pr-comments` already groups comments about one thing into one
  decision and verifies each claim against the code, so the orchestrator only
  tells it that two reviews ran.
- **Manual only** → `disable-model-invocation: true`. It spawns processes and
  publishes to a PR; that is not something a model should decide to start.

## Steps

- [x] 1. **Scope a skill to named agents.** `agents: claude-code` (comma-separated
      ids or aliases) in the source frontmatter. `src/skills.js` parses it into
      `skill.agents`, rejects an unknown id at load time — so `npm run check`
      catches a typo instead of installing the skill nowhere — and strips the key
      from the SKILL.md that gets written. `sync()` in `src/install.js` filters the
      skill list per target before `inspect()`, so pruning removes an out-of-scope
      copy that an earlier version installed.
      — files: `src/skills.js`, `src/install.js`, `test/skills.test.js`,
      `test/install.test.js`
      — done when: new tests cover parse, unknown-id rejection, frontmatter
      stripping, per-agent filtering and the prune-on-narrowing case, and they fail
      before the change

- [x] 2. **The orchestrator skill.** `skills/review-pr-duo/SKILL.md`, frontmatter
      `agents: claude-code` and `disable-model-invocation: true`. What it does:
      1. Resolve the PR — `$ARGUMENTS` or the current branch's PR; stop if there is
         none.
      2. Settle the dirty-checkout question *before* dispatching. `ali-review-pr`
         step 1 asks the user about a dirty or diverging checkout, and neither a
         subagent nor `codex exec` can hold that conversation — so the orchestrator
         checks `git status --short` and `HEAD` against `headRefOid` itself and puts
         the question to the user, then passes the answer down.
      3. Dispatch both, in parallel, and report which two are running:
         - `Agent` tool, `model: "opus"`, clean context, prompt: run the
           `ali-review-pr` skill on PR #N and return the verdict block.
         - `codex exec "Use $ali-review-pr to review PR #N" -s workspace-write -c sandbox_workspace_write.network_access=true`
           in the background. Model and effort come from `~/.codex/config.toml`;
           the network flag is required or `gh api` inside the sandbox publishes
           nothing. If `codex` is not in PATH, say so in one line and run the Claude
           side alone.
      4. Wait for both. Report the two verdicts side by side.
      5. Run `ali-process-pr-comments`, telling it that two independent reviews ran
         and that duplicate findings on the same line are expected and should be
         grouped into one decision.
      — done when: the skill loads under `npm run check` and a live run on a real PR
      produces two reviews and one comment pass

- [x] 3. **Documentation.** A section in `docs/agent-plugins.md` on scoping a skill
      to named agents. The README skills row moved into step 2: `test/readme.test.js`
      fails without it, so the step could not end green otherwise.
      — done when: `npm run check` is green

- [ ] 4. **Live verification** on a real PR in another repository: both reviews
      publish, the Codex sandbox reaches the network, and the comment pass sees
      both sets of threads.

## Known limits

- Both reviews publish under the same `gh` login and both open with 🤖, so a
  reader cannot tell which model raised which finding. Changing that would mean
  editing `ali-review-pr`, which this task deliberately leaves alone.
- A second round is untested territory: each reviewer will read the other's 🤖
  threads as an earlier round of its own. Harmless for the audit pass, but worth
  watching on the first real follow-up.

## Rulings

- Step 1 fired three review lenses (spec, quality, compatibility) rather than the
  usual two. It changed a source format, a loader and a CLI message at once; the
  next step of this size should be cut finer.
- Spec reviewer, `src/skills.js:172` — rejecting an empty `agents:` value goes
  beyond the step's wording. **Kept.** An empty value parses to `[]`, which is
  truthy, so `appliesTo` would answer no for every agent and the skill would
  install nowhere without a word. That silent no-install is the failure the step
  exists to prevent. Cost if this is wrong: five lines of guard and one test.
- Step 2 fired four review lenses (spec, quality, structure, security): one prose
  file that dispatches a subagent, shells out to another CLI and speaks for two
  sibling skills is three planes of risk in one step. Eight blocking findings came
  out of it, all fixed; a step this broad should have been split.
- Spec reviewer — the "if one of them failed, carry on with the other" branch and
  the Language section are not in the step's wording. **Kept.** A spawned process
  that dies is a case this skill creates by spawning it, and without that line the
  run reports nothing at all; every sibling skill carries a Language section.
  Cost if this is wrong: four lines.
- Spec reviewer — the command deviates from the step's literal double-quoted
  `codex exec "..."`. **Kept and taken further:** the prompt now goes through a
  file on stdin, because the step's own form lets the shell eat `$ali-review-pr`
  and a quote in the user's scope.
- Spec reviewer — the live-run half of the done-criterion is unevidenced in the
  diff. **True and open:** it is plan step 4, and nothing here claims otherwise.
- Final gate, structure lens — duo's dependency on `ali-review-pr`'s round
  detection is documented but not pinned by `test/skill-sync.test.js`. **Left
  unpinned.** That test compares byte-identical blocks between skills, and what
  duo now holds is a one-line reference, not a copied block; pinning it would mean
  inventing a block to copy. Cost if this is wrong: change how `ali-review-pr`
  decides which round it is in, and duo's dispatch-ordering rationale goes stale
  with a green build.

## Parked

_(real findings outside this run's scope; each becomes an issue at the end)_
