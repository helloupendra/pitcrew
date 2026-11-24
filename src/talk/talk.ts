import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { Ask, RunState } from '../core/types.js'

export type { Ask, RunState }
import { describeTool } from '../sources/claude-code/parse.js'

/**
 * Talk: Pitcrew runs Claude Code itself (`claude -p` with streaming JSON in and
 * out), so you can send messages from the page. The session file is written by
 * Claude Code as usual, so the timeline shows it like any other session.
 *
 * Nothing is approved automatically. Whenever Claude Code would ask for
 * permission, the bridge (bridge.ts) turns the question into an Ask, and the
 * tool waits until you press Allow or Deny on the page.
 */

export interface RunInfo {
  state: RunState
  startedAt: string
  error?: string
}

export interface Decision {
  allow: boolean
  message?: string
}

export interface TalkOptions {
  /** The Claude Code command. */
  claude: string
  /** Path of the compiled bridge script. */
  bridge: string
  /** Where the bridge reaches this server, e.g. http://127.0.0.1:4747/ */
  serverUrl: () => string
  bridgeToken: string
  /** Called whenever a run or an ask changes, so the page can be told at once. */
  onChange: (sessionId: string) => void
  /** A run with nothing to do for this long is closed (it resumes on the next message). */
  idleMs?: number
  /** How long a quiet run is kept open for background work that has not reported back. */
  backgroundMaxMs?: number
}

interface Run extends RunInfo {
  child: ChildProcess
  stderr: string
  sawResult: boolean
  idleTimer?: NodeJS.Timeout
  /** Background work the session started (a helper agent or a command with run_in_background) that has not reported back. */
  background: number
  /** When the last turn ended; the idle limit for background work counts from here. */
  idleSince: number
}

interface PendingAsk extends Ask {
  decision?: Decision
  waiters: Set<(d: Decision) => void>
}

const IDLE_MS = 15 * 60_000
const STOP_GRACE_MS = 3_000
/** A helper that never reports back still lets the process go after this long. */
const BACKGROUND_MAX_MS = 6 * 60 * 60_000

export class Talk {
  private readonly runs = new Map<string, Run>()
  private readonly asks = new Map<string, PendingAsk>()

  constructor(private readonly opts: TalkOptions) {}

  /**
   * Sends a message to a session. If Pitcrew already runs it, the message goes
   * straight in; otherwise Claude Code starts: a new session with this id, the
   * existing session resumed, or a copy of session `from` under this new id
   * (the original is left as it is).
   */
  send(sessionId: string, cwd: string, text: string, mode: 'new' | 'resume' | 'copy', from?: string, extraArgs: string[] = []): void {
    let run = this.runs.get(sessionId)
    if (!run || run.state === 'ended') run = this.start(sessionId, cwd, mode, from, extraArgs)
    clearTimeout(run.idleTimer)
    run.state = run.state === 'starting' ? 'starting' : 'working'
    run.child.stdin?.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n')
    this.opts.onChange(sessionId)
  }

  /** Stops the agent: Ctrl+C first, then a hard stop if it does not listen. */
  stop(sessionId: string): boolean {
    const run = this.runs.get(sessionId)
    if (!run || run.state === 'ended') return false
    this.denyAll(sessionId, 'Stopped in Pitcrew.')
    run.child.kill('SIGINT')
    setTimeout(() => {
      if (run.state !== 'ended') run.child.kill('SIGTERM')
    }, STOP_GRACE_MS).unref()
    return true
  }

  /** Process ids of the Claude Code runs Pitcrew started, so they are never taken for another window. */
  ownPids(): Set<number> {
    return new Set([...this.runs.values()].map((r) => r.child.pid).filter((p): p is number => p !== undefined))
  }

  run(sessionId: string): RunInfo | undefined {
    const r = this.runs.get(sessionId)
    return r && { state: r.state, startedAt: r.startedAt, error: r.error }
  }

  asksFor(sessionId: string): Ask[] {
    return [...this.asks.values()].filter((a) => a.sessionId === sessionId && !a.decision).map(publicAsk)
  }

  allAsks(): Ask[] {
    return [...this.asks.values()].filter((a) => !a.decision).map(publicAsk)
  }

  /** Called by the bridge: a tool wants permission. Returns the ask's id. */
  ask(sessionId: string, tool: string, input: Record<string, unknown>, cwd?: string, toolUseId?: string): string {
    const step = describeTool(tool, input, cwd)
    const ask: PendingAsk = {
      id: randomUUID(),
      sessionId,
      tool,
      toolUseId,
      title: wish(step.kind, step.title),
      command: step.command,
      path: step.path,
      diff: step.diff,
      at: new Date().toISOString(),
      waiters: new Set(),
    }
    this.asks.set(ask.id, ask)
    this.opts.onChange(sessionId)
    return ask.id
  }

  /** Waits up to `ms` for your answer; undefined means "not yet, ask again". */
  wait(id: string, ms: number): Promise<Decision | undefined> {
    const ask = this.asks.get(id)
    if (!ask) return Promise.resolve({ allow: false, message: 'This question is no longer open.' })
    if (ask.decision) return Promise.resolve(this.settle(ask))
    return new Promise((resolve) => {
      const done = (d: Decision | undefined) => {
        clearTimeout(timer)
        ask.waiters.delete(done)
        resolve(d && this.settle(ask))
      }
      const timer = setTimeout(() => done(undefined), ms)
      ask.waiters.add(done)
    })
  }

  /** Your answer from the page. */
  decide(id: string, allow: boolean): boolean {
    const ask = this.asks.get(id)
    if (!ask || ask.decision) return false
    ask.decision = allow ? { allow: true } : { allow: false, message: 'Denied in Pitcrew.' }
    for (const w of [...ask.waiters]) w(ask.decision)
    this.opts.onChange(ask.sessionId)
    return true
  }

  closeAll(): void {
    for (const [id, run] of this.runs) {
      this.denyAll(id, 'Pitcrew stopped.')
      if (run.state !== 'ended') run.child.kill('SIGTERM')
    }
  }

  private start(sessionId: string, cwd: string, mode: 'new' | 'resume' | 'copy', from: string | undefined, extraArgs: string[]): Run {
    const bridge = {
      mcpServers: {
        pitcrew: {
          command: process.execPath,
          args: [this.opts.bridge],
          env: { PITCREW_URL: this.opts.serverUrl(), PITCREW_BRIDGE_TOKEN: this.opts.bridgeToken, PITCREW_SESSION: sessionId },
        },
      },
    }
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      ...(mode === 'new'
        ? ['--session-id', sessionId]
        : mode === 'copy'
          ? ['--resume', from ?? '', '--fork-session', '--session-id', sessionId]
          : ['--resume', sessionId]),
      '--mcp-config',
      JSON.stringify(bridge),
      '--permission-prompt-tool',
      'mcp__pitcrew__approve',
      ...extraArgs,
    ]
    const child = spawn(this.opts.claude, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const run: Run = { child, state: 'starting', startedAt: new Date().toISOString(), stderr: '', sawResult: false, background: 0, idleSince: 0 }
    this.runs.set(sessionId, run)

    let out = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      out += chunk
      let nl: number
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl)
        out = out.slice(nl + 1)
        this.onEvent(sessionId, run, line)
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      run.stderr = (run.stderr + chunk).slice(-2_000)
    })
    child.on('error', (err: NodeJS.ErrnoException) => {
      run.error =
        err.code === 'ENOENT'
          ? 'Claude Code was not found (the `claude` command). Install it, or start Pitcrew with --claude <path>.'
          : `Could not start Claude Code: ${err.message}`
      this.ended(sessionId, run)
    })
    child.on('exit', (code) => {
      if (code && !run.sawResult && !run.error) run.error = lastLine(run.stderr) || `Claude Code stopped (exit code ${code}).`
      this.ended(sessionId, run)
    })
    return run
  }

  private onEvent(sessionId: string, run: Run, line: string): void {
    let event: { type?: string; is_error?: boolean; result?: unknown; message?: { content?: unknown } }
    try {
      event = JSON.parse(line) as typeof event
    } catch {
      return
    }
    const before = run.state
    run.background = Math.max(0, run.background + backgroundChange(event, line))
    if (event.type === 'result') {
      run.sawResult = true
      run.state = 'idle'
      run.error = event.is_error ? String(event.result ?? 'Claude Code reported an error.') : undefined
      run.idleSince = Date.now()
      this.armIdle(run)
    } else if (event.type === 'assistant' || event.type === 'system') {
      run.state = 'working'
    }
    if (run.state !== before) this.opts.onChange(sessionId)
  }

  /**
   * After a quiet spell the process is closed (the next message resumes the session),
   * but never while background work it started is still running: closing would kill it.
   * That waiting has a limit, in case a "finished" notice never comes.
   */
  private armIdle(run: Run): void {
    clearTimeout(run.idleTimer)
    run.idleTimer = setTimeout(() => {
      if (run.state === 'ended') return
      const waitingOnBackground = run.background > 0 && Date.now() - run.idleSince < (this.opts.backgroundMaxMs ?? BACKGROUND_MAX_MS)
      if (waitingOnBackground || run.state !== 'idle') this.armIdle(run)
      else run.child.stdin?.end()
    }, this.opts.idleMs ?? IDLE_MS)
    run.idleTimer.unref()
  }

  private ended(sessionId: string, run: Run): void {
    if (run.state === 'ended') return
    run.state = 'ended'
    clearTimeout(run.idleTimer)
    this.denyAll(sessionId, 'The session stopped.')
    this.opts.onChange(sessionId)
  }

  private denyAll(sessionId: string, message: string): void {
    for (const a of this.asks.values()) {
      if (a.sessionId === sessionId && !a.decision) {
        a.decision = { allow: false, message }
        for (const w of [...a.waiters]) w(a.decision)
      }
    }
  }

  /** An answered ask is forgotten once the bridge has read the answer. */
  private settle(ask: PendingAsk): Decision {
    this.asks.delete(ask.id)
    return ask.decision!
  }
}

/** "Edited a.ts" is what happened; an ask says what it wants: "Edit a.ts". */
function wish(kind: string, title: string): string {
  if (kind === 'run') return `Run: ${title}`
  return title
    .replace(/^Edited /, 'Edit ')
    .replace(/^Wrote /, 'Write ')
    .replace(/^Read /, 'Read ')
    .replace(/^Opened /, 'Open ')
    .replace(/^Used /, 'Use ')
}

function publicAsk({ waiters: _w, decision: _d, ...ask }: PendingAsk): Ask {
  return ask
}

/**
 * +1 for each tool call that starts work in the background (a helper agent or a
 * command with run_in_background), −1 for each notice that such work finished.
 */
export function backgroundChange(event: { type?: string; message?: { content?: unknown } }, raw: string): number {
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    return event.message.content.filter(
      (b: { type?: string; input?: { run_in_background?: unknown } }) => b?.type === 'tool_use' && b.input?.run_in_background === true,
    ).length
  }
  if (event.type !== 'assistant' && raw.includes('<task-notification>')) {
    return -(raw.match(/<task-notification>/g)?.length ?? 1)
  }
  return 0
}

function lastLine(text: string): string {
  return text.trim().split('\n').filter(Boolean).pop()?.slice(0, 300) ?? ''
}
