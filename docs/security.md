# Security

Pitcrew shows your prompts and your code, and with Talk it can run Claude Code on your machine. This is how it keeps that to you.

## Who can reach it

- It listens on `127.0.0.1` only. Other machines on your network cannot connect.
- Every API call needs the key from the link printed in your terminal (a new random key each start). The key is in the link's `#` part, so it is never sent in a request line or a Referer.
- It answers only to the host names `127.0.0.1`, `localhost` and `[::1]` on its own port, which stops DNS-rebinding pages from talking to it.
- The page sends a strict Content Security Policy, loads nothing from the internet, and cannot be framed.

## What can change something

- Sending a message, Allow/Deny, Stop, running the crew and saving an agent are POST requests. They need the key in the `Authorization` header (not in the URL) and a JSON body. A form or a link on another site can send neither.
- Session ids are checked to be UUIDs before they reach a command line, and commands are started without a shell.
- `--read-only` turns all of it off, and the demo is always read-only.

## What Claude Code may do

- Nothing is approved by Pitcrew. Your Claude Code settings decide what runs without asking. Everything else waits for your Allow on the page.
- The permission bridge has its own key. It can open a permission question and read your answer, and nothing else; the page's key cannot pose as the bridge.
- A session busy in another window is never continued in place.

## What it reads and writes

- It reads `~/.claude/projects` and never writes there. Claude Code writes the session files, as always.
- It runs `git status` in your project folders to count uncommitted files, with `GIT_OPTIONAL_LOCKS=0` so that git does not touch the index either.
- It writes only when you ask: `pitcrew crew install` (agent and command files under `.claude`) and **Make your own** (one new file in `~/.claude/agents`, never overwriting).
- No telemetry, no analytics, no account. Nothing leaves your machine except what Claude Code itself sends to Anthropic.

## Reporting a problem

Please open a GitHub issue without details, and ask for a private way to send them, or use GitHub's private vulnerability reporting on the repository.
