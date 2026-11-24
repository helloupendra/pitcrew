# How Pitcrew works

## Reading sessions

Claude Code writes every session to `~/.claude/projects/<project>/<session>.jsonl`, one JSON object per line: your messages, each block of the agent's reply, each tool result, and bookkeeping (titles, running totals, request logs).

- **Listing.** For the pit wall, Pitcrew reads only the first 192 KB and the last 768 KB of each file: enough for the title, the folder, the branch, the plan, the totals and what happened last. Lines that are only bookkeeping are skipped without being parsed.
- **Opening a session.** It reads the latest 8 MB and turns the lines into steps: a tool call and its result become one step, with the diff, the command output, or the screenshot. Earlier parts load when you ask, so a session file of a gigabyte or more still opens in a fraction of a second.
- **Following.** Files changed in the last ten minutes are checked every second, all files every five seconds. The page gets a server-sent event naming the sessions that changed, and asks only for the steps it does not have yet.

## What a status means

| Status | When |
|---|---|
| Working | The agent wrote in the last few seconds, or a tool it started is still running. |
| Waiting | It asked you a question, or a tool call has had no answer for 45 seconds. The file does not record an open permission prompt, so Pitcrew says "a long task, or your OK in the terminal" rather than pretending to know. For sessions Pitcrew runs, it knows: "Wants your OK: …". |
| Your turn | The agent finished its reply, or you stopped it. |
| Idle | Nothing for 30 minutes. |

## Talk

When you send a message, Pitcrew starts your own Claude Code in the session's folder:

```
claude -p --input-format stream-json --output-format stream-json --verbose
       --session-id <new id>            # a new session
       --resume <id>                    # or: continue one
       --resume <id> --fork-session --session-id <new id>   # or: continue in a copy
       --mcp-config <the bridge> --permission-prompt-tool mcp__pitcrew__approve
```

Claude Code writes the session file as usual, so the timeline follows it like any other session. The process stays open for your next message and closes after 15 quiet minutes; the next message resumes it.

**Permissions.** Whatever your Claude Code settings already allow runs as usual. Anything that would ask goes to a tiny MCP server (`dist/talk/bridge.js`) that Claude Code starts for the session. The bridge asks the Pitcrew page and waits; the page shows the command or the diff with **Allow** and **Deny**.

**Sessions open elsewhere.** Pitcrew never continues a session in place while another Claude Code window may hold it: a process whose command line names the session, or a Claude Code process running in the same folder (macOS and Linux). It offers to continue in a copy instead, which leaves the original untouched.

## The crew

See [crew.md](crew.md).
