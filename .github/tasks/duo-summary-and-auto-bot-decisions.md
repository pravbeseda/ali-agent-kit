# Plain-language summary in `review-pr-duo`, auto-decided bot findings in `process-pr-comments`

## Goal
Two independent fixes to two skills, on one branch: the duo run explains in plain
words what a PR does once both reviewers clear it, and the comment pass stops
asking the user about a machine's finding that has only one sensible answer.

## Decisions
- Where does the duo summary go — chat or a PR comment? → the chat, in the user's
  language, because the PR description already carries that text on the PR and a
  second one there is noise on every clean PR.
- Who writes it? → both reviewers, each returning it with its verdict: they have
  read the whole diff and the duo skill deliberately has not.

## Steps
- [ ] 1. `review-pr-duo`: both dispatch prompts ask for a plain-language summary, and step 3 prints one when both reviewers cleared the PR and neither published a comment — files: `skills/review-pr-duo/SKILL.md` — done when: `npm run check` is green and step 2's two prompts and step 3's all-clear branch both name the summary
- [ ] 2. `process-pr-comments`: a machine's finding whose options have one obviously right answer is decided without asking; behaviour changes and equal options still go to the user — files: `skills/process-pr-comments/SKILL.md` — done when: `npm run check` is green, step 3 names the rule with both exceptions, step 2's one-at-a-time rule accounts for it, and the close block reports what was decided unattended

## Rulings

## Parked
