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

- [ ] 2. **The orchestrator skill.** `skills/review-pr-duo/SKILL.md`, frontmatter
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

- [ ] 3. **Documentation.** A row in the README skills table (`test/readme.test.js`
      fails until it is there), and a section in `docs/agent-plugins.md` on scoping
      a skill to named agents.
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

_(reviewer findings not fixed, and why)_

## Parked

_(real findings outside this run's scope; each becomes an issue at the end)_
