# The crew

Six specialist agents that come with Pitcrew. Each one is an ordinary Claude Code agent file, so you can use them with or without the Pitcrew page.

| Agent | Slash command | What it does | May change files |
|---|---|---|---|
| QA tester | `/qa` | Runs the project, goes through the main flows and edge cases, and reports what broke with steps and screenshots. | Writes only its notes and screenshots under `.pitcrew/qa/` |
| Code reviewer | `/review` | Reviews the current changes (or the branch) for bugs, risks and missing tests, with file and line. | No |
| Security auditor | `/security` | Looks for leaked secrets, injection, missing authorization, unsafe defaults and vulnerable dependencies. | No |
| Test writer | `/tests` | Finds important code with no tests and writes focused tests in the project's own framework. | Tests |
| Docs writer | `/docs` | Brings the README and docs in line with what the code really does. | Docs |
| Dependency doctor | `/deps` | Lists outdated and vulnerable dependencies and proposes a safe upgrade order. | No (unless asked) |

## Use them in Claude Code

```sh
npx pitcrew-cli crew install                    # for every project (~/.claude)
npx pitcrew-cli crew install --project ./myapp  # for one project (./myapp/.claude)
```

Then, in Claude Code: `/qa`, `/review the login change`, `/security`, or just "use the qa-tester agent". Files you already have are kept; `--force` replaces them.

## Run them from Pitcrew

- **Crew** page: pick an agent, a project and (optionally) what to focus on, then press **Run**.
- A project page: one click on **QA**, **Review**, **Security** or **Tests**.
- ⌘K: type "run qa" and the project's name.

Each run is a new session. The agent is handed to Claude Code with `--agents` for that session only, so nothing is installed in the project. Anything it wants to run or change still waits for your **Allow**.

## Make your own

The form at the bottom of the Crew page writes `~/.claude/agents/<name>.md`, and never overwrites an existing agent. You can also write the file yourself:

```markdown
---
name: perf-checker
description: Finds slow pages and heavy queries, with numbers. Use when something feels slow.
tools: Read, Grep, Glob, Bash
---
You are the performance checker on this project's pit crew.

1. …

Report: …
```

`description` is what Claude Code reads to decide when to use the agent, so say when it is useful. `tools` limits what it may use; leave it out to allow everything.
