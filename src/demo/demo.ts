import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, rm, unlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describeTool } from '../sources/claude-code/parse.js'
import { finished, live, type DemoEvent, type DemoSession } from './script.js'

const VERSION = '2.1.0'
const MODEL = 'claude-sonnet-5-5'
/** Seconds between events in the finished sessions. */
const GAP_S = 14
/** Pause between lines while the live session plays, and before it starts again. */
const LIVE_STEP_MS = 1_700
const LIVE_RESTART_MS = 25_000
/** Keeps the finished sessions' "minutes ago" steady while the demo runs. */
const TOUCH_EVERY_MS = 30_000

type Line = Record<string, unknown>

/** The folder name Claude Code uses for a project: its path with "/" and "." turned into "-". */
export const folderFor = (cwd: string) => cwd.replace(/[/.]/g, '-')

/** Turns a demo session into Claude Code session lines, one event at a time. */
export class SessionWriter {
  readonly id = randomUUID()
  private parent: string | null = null
  private toolNo = 0
  private added = 0
  private removed = 0

  constructor(private readonly s: DemoSession) {}

  lines(e: DemoEvent, at: () => Date): Line[][] {
    if ('you' in e) return [[this.user({ role: 'user', content: e.you }, at())]]
    if ('say' in e) return [[this.assistant([{ type: 'text', text: e.say }], e.final ? 'end_turn' : 'tool_use', at())]]
    const id = `toolu_demo_${++this.toolNo}`
    const call = this.assistant([{ type: 'tool_use', id, name: e.tool, input: e.input }], 'tool_use', at())
    if (e.pending) return [[call]]
    const result = this.user(
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: e.result ?? '', is_error: e.error === true }] },
      at(),
      toolUseResult(e),
    )
    // Claude Code keeps running totals of lines changed in a cost-state line.
    const change = describeTool(e.tool, e.input)
    if (!e.error && (change.added || change.removed)) {
      this.added += change.added ?? 0
      this.removed += change.removed ?? 0
      return [[call], [result, { type: 'cost-state', sessionId: this.id, totalCostUSD: 0, totalLinesAdded: this.added, totalLinesRemoved: this.removed }]]
    }
    return [[call], [result]]
  }

  title(at: Date): Line {
    return { type: 'ai-title', aiTitle: this.s.title, sessionId: this.id, timestamp: at.toISOString() }
  }

  private base(type: string, at: Date): Line {
    const uuid = randomUUID()
    const line: Line = {
      parentUuid: this.parent,
      isSidechain: false,
      userType: 'external',
      cwd: this.s.cwd,
      sessionId: this.id,
      version: VERSION,
      gitBranch: this.s.branch,
      type,
      uuid,
      timestamp: at.toISOString(),
    }
    this.parent = uuid
    return line
  }

  private user(message: unknown, at: Date, toolUseResult?: unknown): Line {
    return { ...this.base('user', at), message, ...(toolUseResult ? { toolUseResult } : {}) }
  }

  private assistant(content: unknown[], stop: string, at: Date): Line {
    return {
      ...this.base('assistant', at),
      message: { id: `msg_demo_${randomUUID().slice(0, 8)}`, type: 'message', role: 'assistant', model: MODEL, content, stop_reason: stop, usage: { input_tokens: 0, output_tokens: 0 } },
    }
  }
}

function toolUseResult(e: Extract<DemoEvent, { tool: string }>): unknown {
  if (e.tool === 'Bash') return { stdout: e.error ? '' : e.result ?? '', stderr: e.error ? e.result ?? '' : '', interrupted: false, isImage: false }
  if (e.tool === 'Write') return { type: e.created ? 'create' : 'update', filePath: e.input.file_path, content: e.input.content }
  return undefined
}

const jsonl = (lines: Line[]) => lines.map((l) => JSON.stringify(l) + '\n').join('')

/** Writes a finished session as if it had ended `endedMinutesAgo` minutes ago. */
async function writeFinished(root: string, s: DemoSession): Promise<string> {
  const w = new SessionWriter(s)
  const end = Date.now() - (s.endedMinutesAgo ?? 0) * 60_000
  const steps = s.events.reduce((n, e) => n + ('tool' in e && !e.pending ? 2 : 1), 0)
  let t = end - steps * GAP_S * 1000
  const tick = () => new Date((t += GAP_S * 1000))
  const out: Line[] = [w.title(new Date(t))]
  for (const e of s.events) for (const group of w.lines(e, tick)) out.push(...group)
  const dir = path.join(root, folderFor(s.cwd))
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${w.id}.jsonl`)
  await writeFile(file, jsonl(out))
  return file
}

export interface Demo {
  root: string
  stop(): Promise<void>
}

/**
 * Builds a throwaway projects folder in the system temp folder: a few finished
 * sessions, and one that is written line by line while you watch.
 */
export async function startDemo(): Promise<Demo> {
  const root = await mkdtemp(path.join(tmpdir(), 'pitcrew-demo-'))
  const files = new Map<string, number>()
  for (const s of finished) files.set(await writeFinished(root, s), s.endedMinutesAgo ?? 0)

  const touch = async () => {
    for (const [file, ago] of files) {
      const when = new Date(Date.now() - ago * 60_000)
      await utimes(file, when, when).catch(() => undefined)
    }
  }
  await touch()

  let stopped = false
  const timers = new Set<NodeJS.Timeout>()
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        timers.delete(t)
        resolve()
      }, ms)
      timers.add(t)
    })

  const touchTimer = setInterval(() => void touch(), TOUCH_EVERY_MS)
  const played: string[] = []

  const play = async () => {
    while (!stopped) {
      const w = new SessionWriter(live)
      const dir = path.join(root, folderFor(live.cwd))
      await mkdir(dir, { recursive: true })
      const file = path.join(dir, `${w.id}.jsonl`)
      await writeFile(file, jsonl([w.title(new Date())]))
      played.push(file)
      // One replay at a time, so the demo never shows the same session twice.
      while (played.length > 1) await unlink(played.shift()!).catch(() => undefined)

      for (const e of live.events) {
        for (const group of w.lines(e, () => new Date())) {
          if (stopped) return
          await wait('tool' in e && e.tool === 'Bash' ? LIVE_STEP_MS * 2 : LIVE_STEP_MS)
          const now = new Date().toISOString()
          for (const line of group) line.timestamp = now
          await appendFile(file, jsonl(group))
        }
      }
      await wait(LIVE_RESTART_MS)
    }
  }
  void play()

  return {
    root,
    stop: async () => {
      stopped = true
      clearInterval(touchTimer)
      for (const t of timers) clearTimeout(t)
      await rm(root, { recursive: true, force: true })
    },
  }
}
