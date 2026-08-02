---
name: generate-pr-description-uc
description: Generate a PR description for the Unite Client (UC) project in Markdown by comparing the current branch with origin/develop and filling the UC pull request template — Problem, Solution, Changes, Affected Areas plus the mandatory review, testing and self checklists. Use only in repositories of the Unite Client project, the ones that integrate through an origin/develop branch; in any other repository this skill stops at its first step instead of producing a description. Triggers when the user asks to "write the PR description", "generate a description for this PR", or runs /ali-generate-pr-description-uc.
---

# Goal

Compare the current Git branch with `origin/develop` and generate a complete PR description in Markdown format following the standard pull request template of the **Unite Client** project. Output the result as a raw Markdown source block so the user can copy-paste it into the PR manually.

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

4. **Generate PR description** using the Output Template below.
   Write ONLY the dynamic sections (Problem, Solution, Changes, Affected Areas) yourself.
   Do NOT regenerate the checklists — they will be assembled from the template verbatim in the next step.

5. **Assemble the full description** by concatenating:
   - your generated dynamic sections (from step 4)
   - the three checklist sections copied character-for-character from the Output Template
   Copying keeps the checklists out of the generated text, so nothing below has to repair them.

6. **Self-check before showing it to the user.** Each check has its own fix:
   - *Generated sections only* (Problem, Solution, Changes, Affected Areas) — look for a substring of 4+ characters repeating 3 or more times in a row (e.g. `####fected A####fected A####fected A`). This is the artifact this check exists for. If found, regenerate step 4 (up to 2 retries).
   - *Assembly* — every expected `# Section` header present exactly once, and each checklist item `[ ]` count matching the template (2 + 5 + 4 = 11 items). A failure here means the concatenation went wrong, not the generation: redo step 5, copying the checklists from the Output Template again.

7. **Output the final description** as a fenced Markdown source code block (` ```markdown ... ``` `) so the user can copy-paste it into the PR on GitHub.
   Do NOT save to a file. Do NOT publish to GitHub. The user handles that manually.

# Output Template

The sections Problem, Solution, Changes, Affected Areas must be filled based on the diff analysis. The checklists below must be included verbatim — never modify or remove them.

```markdown
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
```

# Guidelines

- Write the description in English
- The total output MUST NOT exceed 3000 characters — shorten your generated content (Problem, Solution, Changes, Affected Areas) as needed, but NEVER truncate or remove the template sections (checklists)
- Be specific and concise in each section
- Use bullet points for multiple items in Changes section
- List all affected plugins/modules/components in Affected Areas
- Reference any related Jira tickets if identifiable from branch name or commits
- If the branch name contains a ticket ID (e.g., UC-XXXXX), include it in the Problem section
- For Affected Areas, mention which targets are impacted (desktop, web, teams, etc.) based on changed file paths

