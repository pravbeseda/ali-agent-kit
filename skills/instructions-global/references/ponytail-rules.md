<!-- curated: source=https://raw.githubusercontent.com/DietrichGebert/ponytail/refs/heads/main/AGENTS.md ref=2a1fe842d078cf66ec7f3e6096a8ca4279c2cad7 curated=2026-10-16 -->
# Ponytail rules, curated

The optional "Ponytail rules" block of the master is rendered from the rule
lines below (`scripts/lib/ponytail.js`); everything else in this file is for
the maintainer.

Curation: only what the Karpathy block does not already say, phrased to stand
alone (no section references), so the block reads the same with or without
Karpathy. Left out on purpose: the "lazy senior developer" persona and the
minimal-change ladder (Karpathy §2 and §3 cover them), the comment rule (most
users already have one), and "one small test or an assert" (it contradicts
test-first rules).

An id is stable once released: `ponytail.skip` in a machine's config names
rules by id. Reword a rule under its id; give a new rule a new id; drop an id
only together with its rule. When `ponytail.js status` reports that upstream
moved past `ref`, re-read upstream `AGENTS.md`, re-curate, and update `ref`
and `curated` in the header.

- [reuse-first] Before writing new code, take the first option that fully works: what this codebase already has (used the way the surrounding code uses it), then the standard library or platform, then an installed dependency; never add a dependency for a few lines.
- [full-reach] The scope of a change is every place it must reach: callers, tests, fixtures, config, exports; for a bug fix, find every caller of the function you touch and fix the root cause once in the shared code.
- [never-cut] Simplicity never cuts validation at trust boundaries, error handling that prevents data loss, security or accessibility.
- [shortcut-comment] Mark a deliberate shortcut with a known limit by a comment in the form `shortcut: <the limit>, <when to upgrade>`.
- [report-skipped] End a report of finished work with one line: what you skipped or did not check, and any risk I must know.
