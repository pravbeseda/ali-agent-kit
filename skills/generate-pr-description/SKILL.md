---
name: generate-pr-description
description: Generate a pull request description for the current branch, filling the repository's own .github/pull_request_template.md when it has one. Use when the user asks to write the PR description, or runs /ali-generate-pr-description.
---

# Goal

Compare the current Git branch with its base branch and generate a complete PR description in Markdown, laid out in **the repository's own pull request template** when the branch carries one, and in the neutral fallback of [The default template](#the-default-template) when it does not. Output the result as a raw Markdown source block so the user can copy-paste it into the PR manually.

# Steps

1. **Resolve the base branch.** Never assume `main`: a repository can default to `main` and still integrate everything through `develop`, and a diff against the wrong base invents changes this branch never made.

   1. If the branch already has an open pull request, its base is the answer:
      ```bash
      branch=$(git rev-parse --abbrev-ref HEAD)
      gh pr list --head "$branch" --state open --json baseRefName --jq '.[0].baseRefName // empty'
      ```
      Empty output (or no `gh`, or a non-GitHub `origin`) just means "no answer here" — move on.
   2. Otherwise probe for an integration branch, then fall back to the remote default:
      ```bash
      git ls-remote --heads origin refs/heads/develop refs/heads/staging
      git ls-remote --symref origin HEAD    # the "ref: refs/heads/<name>" line is the default
      ```
      The full `refs/heads/` patterns are deliberate — `ls-remote` matches a bare pattern against the tail of the ref, so a bare `develop` would also match `feat/develop`. If the probe comes back with any branch other than the one the default resolves to, list **every** branch it found alongside that default and ask the user to pick one of them: the probe can return several, and picking for them is what makes two runs describe the same branch against different bases. If it comes back empty, or names only the default itself, take the default silently.
   3. If nothing resolves — no remote, no network — ask the user for the base branch. Do not guess.

   State in one line which base was chosen and why, then fetch it:
   ```bash
   git fetch origin {base}
   ```
   A failed fetch ends the run: a description written against a stale base describes work that is not in the diff.

2. **Gather branch info** (the summary and the commit messages are independent — run them in parallel; the detailed diff depends on what the summary shows):

   - Diff summary:
     ```bash
     git --no-pager diff FETCH_HEAD...HEAD --stat
     ```
   - Commit messages:
     ```bash
     git --no-pager log FETCH_HEAD..HEAD --oneline
     ```
   - Detailed diff — only when the change is small. Read `--stat` first: if it reports more than 20 changed files or more than 800 changed lines, skip the full diff entirely and read the important files individually (`git --no-pager diff FETCH_HEAD...HEAD -- path/to/file`), picking them by the size of their `--stat` bar. Otherwise:
     ```bash
     git --no-pager diff FETCH_HEAD...HEAD -- . ':!*.lock' ':!*package-lock*' | head -1500
     ```
     The cap counts lines, not characters, so it is a backstop against a runaway diff — not a substitute for the `--stat` check above.

   Diff from `FETCH_HEAD`, not from `origin/{base}`: in a narrow clone the latter can be a leftover ref that no fetch ever updates.

3. **Find the template in the current branch.** Ask git rather than guessing at a path, so the search covers the locations GitHub itself accepts and survives a repository that spells the file in upper case:

   ```bash
   git ls-files --full-name -- ':(icase).github/pull_request_template.md' ':(icase)pull_request_template.md' ':(icase)docs/pull_request_template.md' ':(icase).github/pull_request_template/' ':(icase)docs/pull_request_template/'
   ```

   The last two pathspecs end in a slash and carry no `.md`: they name the **directory** form GitHub also accepts, and a pathspec ending in `.md` matches nothing inside it.

   - **Exactly one hit** — read it **in full, from the file**, and use it as the template. Never write a template from memory, and above all never write a checklist from memory: a remembered copy with a plausible number of `[ ]` items sails through the step 6 check while quietly differing from what the team maintains.
   - **Several hits** — name them to the user and ask which one to fill, rather than picking one yourself. This is what a `PULL_REQUEST_TEMPLATE/` directory of named templates — bug, feature, release — looks like here.
   - **No hit** — say so in one line, then use [The default template](#the-default-template) at the end of this file.

4. **Analyze changes** and identify what the template actually asks for. Across templates that is usually some subset of:
   - what problem or issue is being addressed (from commit messages, branch name, code changes)
   - what solution approach was implemented
   - what specific changes were made
   - what areas of the codebase are affected

5. **Fill the template in place.** Replace the placeholder lines — italic prompts, HTML comments, `TODO`s — with what step 4 found, but only the ones that ask for a *description*. Some placeholder lines are requests to the author, not to you:

   - A line asking for evidence — a gif or a video, a screenshot, a per-target proof, a link to a test run — **stays exactly as it is**. Nobody can produce a recording from a diff, and deleting the line removes the reminder the team put there. Where the changed paths tell you something about it (which targets are involved, for instance), add that next to the line instead of dropping it.
   - A line asking for a description gets replaced.
   - Everything else — headings, checklists, tables, HTML — is data, not prose to rewrite: reproduce it exactly as read, same wording, same numbering, same `[ ]` items. Never modify or drop a checklist.

6. **Self-check before showing it to the user.** Each check has its own fix:
   - *The sections you wrote* — look for a substring of 4+ characters repeating 3 or more times in a row (e.g. `####fected A####fected A####fected A`). This is a real corruption that has been observed in this output, and reading the template from a file does nothing to prevent it, because it happens in the text you generate. If found, redo step 5 for the affected section (up to 2 retries).
   - *The parts copied from the template* — every heading present exactly once, and as many `[ ]` items as the template file contains. Count them in the template itself rather than against a number written into these steps:
     ```bash
     grep -c '\[ \]' <template-path>
     ```
     A mismatch means the copy went wrong, never that the template is wrong — re-read the template and reproduce the checklists from it, and never edit the output to reach an expected count.

7. **Output the filled template** as a fenced Markdown source code block (` ```markdown ... ``` `) so the user can copy-paste it into the PR on GitHub. **Make the fence longer than the longest run of backticks inside the description** — a template carrying its own ` ``` ` code block closes a three-backtick fence early and splits the output into pieces that no longer copy as one, so use four backticks there, five against four, and so on. After the block, remind the user in one line what the description still needs from them — the evidence lines you kept in step 5, if there were any.
   Do NOT save to a file. Do NOT publish to GitHub. The user handles that manually.

# Guidelines

- **The text you write MUST NOT exceed 3000 characters** — shorten your own sections as needed. The budget covers only what you wrote: everything copied from the template goes out in full however long it is, and a template that is itself longer than the budget is not a reason to truncate anything.
- Be specific and concise in each section
- Use bullet points for multiple items
- Reference any related ticket if identifiable from the branch name or commits (e.g. a `UC-12345`-style ID in the branch name belongs in the first section)
- Mention which build targets or packages are impacted, based on the changed file paths, wherever the template has a place for it

# Language

- Discussion with the user — the language they write in, or the chat language configured by the user, if one is defined.
- Anything copied from the template — reproduced verbatim, in whatever language the team wrote it. Never translate a heading or a checklist item.
- The sections you write yourself — the language of the template you are filling, so the description reads as one document; **English** when no template was found and the default one is used. Never the language of the conversation.

# The default template

Used **only** when step 3 found no template in the repository. The `~~~~` fence is this file's delimiter, not part of the template.

~~~~markdown
# Problem

_Describe the problem or issue that this PR is solving._

# Solution

_Describe the idea of the solution that was implemented in this PR and how it solves the problem._

# Changes

_Describe the changes that were made in this PR according to the solution._

# Affected Areas

_Describe the areas of the codebase impacted by this PR._

# Testing

_Describe how the changes were verified._
~~~~
