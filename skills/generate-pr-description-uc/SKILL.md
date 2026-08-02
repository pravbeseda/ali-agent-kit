---
name: generate-pr-description-uc
description: Generate a PR description for the Unite Client (UC) project by diffing the current branch against origin/develop and filling the UC pull request template — Problem, Solution, Changes, Affected Areas plus the mandatory checklists. Only for Unite Client repositories, which are the ones with an origin/develop branch. Use when the user asks to "write the PR description", "generate a description for this PR", or runs /ali-generate-pr-description-uc.
---

# Goal

Compare the current Git branch with `origin/develop` and generate a complete PR description in Markdown format following the standard pull request template of the **Unite Client** project, which lives in `references/pr-template.md` next to this file. Output the result as a raw Markdown source block so the user can copy-paste it into the PR manually.

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

4. **Read the template.** Read `references/pr-template.md` from this skill's directory. It holds the four dynamic sections as italic placeholders (Problem, Solution, Changes, Affected Areas) followed by the three checklists.

5. **Fill the template in place.** Replace the italic placeholder lines under each dynamic heading with what step 3 found. Everything from `# Review persons Checklist` down is data, not prose to rewrite: reproduce it exactly as read — same wording, same numbering, same 11 `[ ]` items. Never modify or drop a checklist.

6. **Output the filled template** as a fenced Markdown source code block (` ```markdown ... ``` `) so the user can copy-paste it into the PR on GitHub.
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

- Discussion with the user — the language they write in.
- The PR description itself — **always English**, whatever language the conversation is in. Every word inside the output block, including the sections you wrote yourself, is English.

