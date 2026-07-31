# ali-agent-kit

Skills distributed over npm and installed into Claude Code, Copilot CLI and Codex CLI.

## Language

**English only, everywhere in the repository** — code, comments, skills, docs, README, commit messages, CLI output, test names. No Cyrillic. `test/language.test.js` fails the build on any Cyrillic character in a tracked file. Conversations may be in any language; the repository is not.

## Conventions

- Zero runtime dependencies, plain ESM, no build step. Keep it that way.
- Never create an agent's config dir; its existence is the "agent is installed" signal.
- Never write to a path without our ownership marker (`.ali-agent-kit.json`).
- Skill sources carry no `ali-` prefix; it is added on install.
- `npm run check` (validate + tests) must pass before a commit.
