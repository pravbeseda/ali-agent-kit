# ali-autopilot — Claude Code only

## Goal

Scope `ali-autopilot` to Claude Code with the `agents:` frontmatter key, and drop
the cross-host text that key makes dead. The skill's review gates are built on
subagents with a clean context; Codex CLI and Copilot CLI have no subagent
primitive, so on those hosts the skill degrades to self-review — on the one skill
in the set that commits, pushes and opens a pull request unattended.

A second pass then cuts what the run spends where the spend was duplicated: the
reviewer tiers, the lens set, and the implementer's floor.

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
  `opus` for none or one, `fable` for two. The floor stays at `opus` because the
  lens count measures risk planes, not how hard the code is to write: an
  under-powered implementer buys a round of the gate, which is more `fable` than
  the tier ever saved. Rejected: a second complexity rubric beside the lenses,
  which would be a vocabulary with nothing enforcing it.
- **Why routing down is safe** → the bar does not move with it. Every reviewer that
  judges the code against a bar stays on `fable` whatever wrote it, so a weaker
  implementer costs a round of fixes, never a finding nobody made.
- **Which reviewer is routed** → the spec reviewer alone, to `opus`. Its question
  is bounded by the step's own text, and it is half the gate on the ordinary step,
  which fires no lens. Quality and the lenses stay on `fable`: they are the only
  predecessor to a pull request this skill opens unattended.
- **Which lenses survive** → `security` and `compatibility`. `structure` and
  `tests` are dropped as duplicates: the quality reviewer's bar already names one
  decision edited in two places, a broken seam and an assertion that cannot fail,
  and the spec reviewer already asks whether the done-criterion is met by what the
  test asserts.
- **The §2 lens ceiling** → removed, not tightened. With two lenses left, "inside
  two" can never bind, and tightening it to one would cut plans finer and add
  gates, which is the opposite of the goal. The `lenses:` line stays — the
  implementer's tier is read off it.
- **Rejected: a prebuilt context bundle for reviewers** →
  `references/reviewer-prompt.md` tells every reviewer to read every changed file
  in full, so the repeated reading is the gate rather than overhead. Moving it into
  the dispatch prompt costs the same tokens and puts the file bodies in the
  orchestrator's context, which is what §4's delegation exists to keep out.
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
- [x] 9. Raise the implementer floor to `opus` — files: `skills/autopilot/SKILL.md` (§4) — done when: `sonnet` appears nowhere in the file and `npm run check` passes.
- [x] 10. Route the spec reviewer to `opus` — files: `skills/autopilot/SKILL.md` (§4.1, §6) — done when: each always-on reviewer carries its own `model:` and §6 no longer says "the same model as the step gates".
- [x] 11. Drop the `structure` and `tests` lenses — files: `skills/autopilot/SKILL.md` (§4.1) — done when: the lens table has two rows and one line says why those two planes need no reviewer of their own.
- [x] 12. Remove the dead lens ceiling — files: `skills/autopilot/SKILL.md` (§2, §4.1) — done when: `grep -n 'three or more' skills/autopilot/SKILL.md` is empty and §2 only asks for the lenses to be named.

## Rulings

## Parked
