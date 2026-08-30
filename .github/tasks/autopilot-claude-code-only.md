# ali-autopilot — Claude Code only

## Goal

Scope `ali-autopilot` to Claude Code with the `agents:` frontmatter key, and drop
the cross-host text that key makes dead. The skill's review gates are built on
subagents with a clean context; Codex CLI and Copilot CLI have no subagent
primitive, so on those hosts the skill degrades to self-review — on the one skill
in the set that commits, pushes and opens a pull request unattended.

## Decisions

- **Which hosts** → Claude Code only, expressed as `agents: claude-code`, the same
  mechanism `ali-review-pr-duo` already uses.
- **The self-review fallback** → removed, not kept as insurance. Subagents are
  always available in Claude Code, so the section can no longer be reached.
- **Codex sidecar** → `agents/openai.yaml` is deleted with it; it configures a host
  the skill no longer installs into.
- **Not changed** → the reviewer bar in `references/reviewer-prompt.md`, which
  `test/skill-sync.test.js` keeps identical to `ali-review-branch`'s.
- **Who writes a step** → a subagent with a clean context, one per step. The main
  context then holds the plan, the diffs and the rulings, not the reasoning behind
  every line, which is what a seven-step run runs out of first.
- **Which model it gets** → the step's lens count, the estimate §2 already makes:
  none `sonnet`, one `opus`, two `fable`. Rejected: a second complexity rubric
  beside the lenses, which would be a vocabulary with nothing enforcing it.
- **Why routing down is safe** → the gate does not move with it. Reviewers stay on
  `fable` whatever wrote the code, so a weaker implementer costs a round of fixes,
  never a finding nobody made. Reviewers are deliberately not routed: they are the
  only predecessor to a pull request this skill opens unattended.
- **Who applies a fix** → the orchestrator, not the implementer, which has already
  returned. A ruling is context a fresh subagent would not have.

## Steps

- [x] 1. Add `agents: claude-code` to the frontmatter — files: `skills/autopilot/SKILL.md` — done when: `npm run check` passes and the key sits between `description` and `disable-model-invocation`, as in `skills/review-pr-duo/SKILL.md`.
- [x] 2. Drop the other-host hedging from the two dispatch sentences — files: `skills/autopilot/SKILL.md` (§4.1, §6.2) — done when: neither sentence names a host alternative and `grep -n 'another host' skills/autopilot/SKILL.md` is empty.
- [x] 3. Delete the "When the host has no subagents" section and `agents/openai.yaml` — files: `skills/autopilot/SKILL.md`, `skills/autopilot/agents/openai.yaml` — done when: both are gone and `npm run check` passes.
- [x] 4. Prefix the README row with the host scope — files: `README.md` — done when: the `ali-autopilot` row opens with "Claude Code only", matching the `ali-review-pr-duo` row, and `test/readme.test.js` passes.
- [x] 5. Drop the last host hedging — files: `skills/autopilot/SKILL.md` (§3) — done when: the todo-list sentence no longer says "if the host has one".
- [x] 6. Carry the lens estimate on the step line — files: `skills/autopilot/SKILL.md` (§2, §3) — done when: the `## Steps` template has a `lenses:` field and §2 says the count picks the implementer's model.
- [x] 7. Delegate the implementation to a routed subagent — files: `skills/autopilot/SKILL.md` (§4) — done when: step 1 dispatches an `Agent` on the tier the lens count sets, and step 2 names the implementer's report as a claim the orchestrator re-runs.
- [x] 8. Keep the fixes with the orchestrator — files: `skills/autopilot/SKILL.md` (§4.2) — done when: the **Fix** verdict says who applies it and why not the implementer.

## Rulings

## Parked
