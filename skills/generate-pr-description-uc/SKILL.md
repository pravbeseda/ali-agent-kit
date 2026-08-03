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

4. **Read the template — this is a precondition, not a best effort.** Read `references/pr-template.md` from **this skill's own directory**, not from the current working directory: the relative path resolves against the project the user happens to be in, where no such file exists. If the agent states the skill's base directory, read it from there. Otherwise try the installed locations directly, whichever exists:

   ```bash
   for base in "${CLAUDE_CONFIG_DIR:-$HOME/.claude}" "${CODEX_HOME:-$HOME/.codex}" "${COPILOT_CONFIG_DIR:-$HOME/.copilot}"; do
     ls "$base/skills/ali-generate-pr-description-uc/references/pr-template.md" 2>/dev/null
   done
   ```

   Those three variables are what the installer itself resolves the config directory from, so a plain `~/.claude/...` guess misses the file whenever one of them is set — which is exactly when the user has configured things deliberately.

   If more than one path matches, the copies belong to different agent installations and may have drifted. Do not try to key off which agent is running: the loop is only reached because the agent does not know its own base directory — otherwise the primary path above already resolved it — so that signal is exactly what is missing, and taking the first `ls` hit could read a stale copy. Compare the matches instead (`diff` them). If they are byte-identical it does not matter which is read: read one and say which. If they differ, do not silently pick one — a stale copy must not win unseen: report the matching paths and their difference to the user, and read the copy they choose.

   **If the file cannot be read anywhere, stop and say so.** Never reconstruct the template, and above all never write the checklists from memory — reproducing them from a file is the entire reason they live in one, and a remembered copy with a plausible number of `[ ]` items sails through the step 6 check while quietly differing from what the team maintains.

   The file holds the four dynamic sections as italic placeholders (Problem, Solution, Changes, Affected Areas) followed by the three checklists.

5. **Fill the template in place.** Replace the italic placeholder lines under each dynamic heading with what step 3 found — but only the ones that ask for a description. Some italic lines are requests to the author, not placeholders for you:

   - Under `# Affected Areas and visual reference`, replace only *"Describe the affected areas of the codebase…"*. Keep *"Provide gif/video of main affected scenarios"* and *"If changes affects various targets … provide proof for each target"* exactly as they are: nobody can produce a recording or a per-target screenshot from a diff, and deleting the lines removes the reminder the team put there. When the changed paths show that several targets are involved, name them next to the targets line instead of dropping it.
   - The same rule holds anywhere else in the template: an italic line asking for evidence stays, an italic line asking for a description gets replaced.

   Everything from `# Review persons Checklist` down is data, not prose to rewrite: reproduce it exactly as read — same wording, same numbering, same `[ ]` items. Never modify or drop a checklist.

6. **Self-check before showing it to the user.** Each check has its own fix:
   - *The sections you wrote* (Problem, Solution, Changes, Affected Areas) — look for a substring of 4+ characters repeating 3 or more times in a row (e.g. `####fected A####fected A####fected A`). This is a real corruption that has been observed in this output, and reading the template from a file does nothing to prevent it, because it happens in the text you generate. If found, redo step 5 for the affected section (up to 2 retries).
   - *The parts copied from the template* — every `# Section` header present exactly once, and as many `[ ]` items as the template you read in step 4 contains. Count them there rather than against a number written here: the template is maintained by the UC team, and a checklist item added on their side must not turn a faithful copy into a failing one. A mismatch means the copy went wrong, never that the template is wrong — read `references/pr-template.md` again and reproduce the checklists from it, and never edit the output to reach an expected count.

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

