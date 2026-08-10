---
name: generate-pr-description-uc
description: Generate a PR description for the Unite Client (UC) project by diffing the current branch against origin/develop and filling the UC pull request template — Problem, Solution, Changes, Affected Areas plus the mandatory checklists. Only for Unite Client repositories, which are the ones with an origin/develop branch. Use when the user asks to "write the PR description", "generate a description for this PR", or runs /ali-generate-pr-description-uc.
---

# Goal

Compare the current Git branch with `origin/develop` and generate a complete PR description in Markdown format following the standard pull request template of the **Unite Client** project, which is embedded in [The template](#the-template) at the end of this file. Output the result as a raw Markdown source block so the user can copy-paste it into the PR manually.

# Steps

1. **Check the preconditions, then fetch.** This skill only applies to Unite Client repositories, and `origin/develop` is what identifies one:
   ```bash
   git ls-remote --exit-code --heads origin develop
   ```
   If that exits non-zero (no such remote branch, or not a Git repository at all), **stop right here**: tell the user this skill is for Unite Client repositories, which integrate through `origin/develop`, and that this repository has no such branch. Do not fall back to another base branch, do not diff against anything else, do not continue to step 2.

   Otherwise fetch the latest state:
   ```bash
   git fetch origin develop
   ```

2. **Gather branch info** (the summary and the commit messages are independent — run them in parallel; the detailed diff depends on what the summary shows):

   - Diff summary:
     ```bash
     git --no-pager diff origin/develop...HEAD --stat
     ```
   - Commit messages:
     ```bash
     git --no-pager log origin/develop..HEAD --oneline
     ```
   - Detailed diff — only when the change is small. Read `--stat` first: if it reports more than 20 changed files or more than 800 changed lines, skip the full diff entirely and read the important files individually (`git --no-pager diff origin/develop...HEAD -- path/to/file`), picking them by the size of their `--stat` bar. Otherwise:
     ```bash
     git --no-pager diff origin/develop...HEAD -- . ':!*.lock' ':!*package-lock*' | head -1500
     ```
     The cap counts lines, not characters, so it is a backstop against a runaway diff — not a substitute for the `--stat` check above.

3. **Analyze changes** and identify:
   - What problem/issue is being addressed (from commit messages, branch name, code changes)
   - What solution approach was implemented
   - What specific changes were made
   - What areas of the codebase are affected

4. **Take the template from [The template](#the-template) below — from the file, never from memory.** Above all never write the checklists from memory: reproducing them from the written template is the entire reason it is embedded here, and a remembered copy with a plausible number of `[ ]` items sails through the step 6 check while quietly differing from what the team maintains.

   The template holds the four dynamic sections as italic placeholders (Problem, Solution, Changes, Affected Areas) followed by the three checklists.

5. **Fill the template in place.** Replace the italic placeholder lines under each dynamic heading with what step 3 found — but only the ones that ask for a description. Some italic lines are requests to the author, not placeholders for you:

   - Under `# Affected Areas and visual reference`, replace only *"Describe the affected areas of the codebase…"*. Keep *"Provide gif/video of main affected scenarios"* and *"If changes affects various targets … provide proof for each target"* exactly as they are: nobody can produce a recording or a per-target screenshot from a diff, and deleting the lines removes the reminder the team put there. When the changed paths show that several targets are involved, name them next to the targets line instead of dropping it.
   - The same rule holds anywhere else in the template: an italic line asking for evidence stays, an italic line asking for a description gets replaced.

   Everything from `# Review persons Checklist` down is data, not prose to rewrite: reproduce it exactly as read — same wording, same numbering, same `[ ]` items. Never modify or drop a checklist.

6. **Self-check before showing it to the user.** Each check has its own fix:
   - *The sections you wrote* (Problem, Solution, Changes, Affected Areas) — look for a substring of 4+ characters repeating 3 or more times in a row (e.g. `####fected A####fected A####fected A`). This is a real corruption that has been observed in this output, and taking the template from a file does nothing to prevent it, because it happens in the text you generate. If found, redo step 5 for the affected section (up to 2 retries).
   - *The parts copied from the template* — every `# Section` header present exactly once, and as many `[ ]` items as [The template](#the-template) contains. Count them there rather than against a number written into the steps: the template block is what tracks the UC team's own copy, and a checklist item added on their side must not turn a faithful copy into a failing one. A mismatch means the copy went wrong, never that the template is wrong — re-read the template block and reproduce the checklists from it, and never edit the output to reach an expected count.

7. **Output the filled template** as a fenced Markdown source code block (` ```markdown ... ``` `) so the user can copy-paste it into the PR on GitHub. After the block, remind the user in one line what the description still needs from them: the gif or video, and the per-target proof when more than one target is affected.
   Do NOT save to a file. Do NOT publish to GitHub. The user handles that manually.

# Guidelines

- The total output MUST NOT exceed 3000 characters — shorten what you wrote into the dynamic sections (Problem, Solution, Changes, Affected Areas) as needed, but NEVER truncate or remove the checklists
- Be specific and concise in each section
- Use bullet points for multiple items in Changes section
- List all affected plugins/modules/components in Affected Areas
- Reference any related Jira tickets if identifiable from branch name or commits
- If the branch name contains a ticket ID (e.g., UC-XXXXX), include it in the Problem section
- For Affected Areas, mention which targets are impacted (desktop, web, teams, etc.) based on changed file paths

# Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- The PR description itself — **always English**, whatever language the conversation is in. Every word inside the output block, including the sections you wrote yourself, is English.

# The template

The block below is data, maintained to match the UC team's pull request template — when their copy changes, this block is what gets updated, and nothing else in this skill hardcodes its contents. The `~~~~` fence is this file's delimiter, not part of the template.

~~~~markdown
# Problem

_Describe the problem or issue that this PR is solving._

# Solution

_Describe the idea of solution that was implemented in this PR and how it solves the problem._

# Changes

_Describe the changes that were made in this PR according to the solution._

# Affected Areas and visual reference

_Describe the affected areas of the codebase that was impacted by this PR._
_Provide gif/video of main affected scenarios_
_If changes affects various targets (origin/cca-agent/teams etc) provide proof for each target_

# Review persons Checklist

1. [ ] QA engineer who verifies tests and cases is assigned to the PR
2. [ ] Person who is responsible/knowledgeable for the area of the codebase is assigned to the PR

# Testing Checklist

1. [ ] Test-cases are created and reviewed, linked to Story/Bug Jira item
2. [ ] New cases are covered with Cypress / e2e C# tests
3. [ ] Screenshots with passed locally with repeats added/updated tests (Cypress) **are added to description of PR**
4. [ ] Links with runs with repeats at build agent for added/updated e2e C# tests **are added to description of PR**
5. [ ] Manual test-case executions are linked to Story/Bug Jira item

# Self Checklist

Please make sure you pass the following checklist before asking colleagues for review:

1. [ ] Do smoketest yourself: run code changes locally and check cases
    - **verify** locally builds desktop/web terminal outputs
2. [ ] Verify PR for checks — validation build are green
3. [ ] Verify changed area covered with some of unit tests / Cypress
    - you should have **strong reason** for absence of it or it was refactoring
4. [ ] Verify changed area covered with necessary logs
~~~~
