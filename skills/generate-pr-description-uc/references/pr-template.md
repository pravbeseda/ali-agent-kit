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
