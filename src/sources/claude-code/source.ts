import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { uncommittedFiles } from '../../core/git.js'
import { readLines } from '../../core/lines.js'
import type { ActivityItem, FileTouched, Overview, Project, SessionDetail, SessionStatus, SessionSummary, Step, StepKind } from '../../core/types.js'
import { clip, Parser, type Picture, type SessionMeta } from './parse.js'
import { statusOf } from './status.js'

/** The first and last parts of a file are enough to list a session. */
const HEAD_BYTES = 192 * 1024
const TAIL_BYTES = 768 * 1024
/** How much of an opened session is read at once; long sessions load earlier parts on request. */
const WINDOW_BYTES = 8 * 1024 * 1024
/** Steps sent when a session is first opened. */
const FIRST_STEPS = 400
/** Sessions changed within this window are checked every second; the rest every few seconds. */
const RECENT_MS = 10 * 60_000
const MAX_OPEN_READERS = 6
/** Lines in the feed across all projects, and how many each session may add. */
const FEED_ITEMS = 40
/** Idle sessions listed after the live ones, newest first. */
const EARLIER_ITEMS = 40
const FEED_PER_SESSION = 8
/** Steps worth a line in the feed: reading files and plan updates would drown the rest. */
const FEED_KINDS = new Set<StepKind>(['you', 'agent', 'edit', 'write', 'run', 'search', 'web', 'helper', 'ask', 'note'])
const DAY_MS = 86_400_000

const SESSION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

export function defaultRoot(): string {
  const config = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude')
  return path.join(config, 'projects')
}

interface SessionFile {
  id: string
  projectId: string
  file: string
  size: number
  mtimeMs: number
}

/** What a session's file says, before the clock is applied. */
interface Facts {
  meta: SessionMeta
  title: string
  pending: Step[]
  lastAgentText?: string
  /** The last few steps, for the feed. */
  recent: Step[]
}

interface CachedFacts {
  size: number
  mtimeMs: number
  facts: Promise<Facts | null>
  /** Set once `facts` has resolved. */
  done?: Facts | null
}

export class ClaudeCodeSource {
  private readonly files = new Map<string, SessionFile>()
  private readonly facts = new Map<string, CachedFacts>()
  private readonly readers = new Map<string, SessionReader>()

  private readonly clock: () => number
  private readonly windowBytes: number

  constructor(
    readonly root: string,
    opts: { clock?: () => number; windowBytes?: number } = {},
  ) {
    this.clock = opts.clock ?? Date.now
    this.windowBytes = opts.windowBytes ?? WINDOW_BYTES
  }

  /** Lists every session file. Returns the ids that are new or changed since the last scan. */
  async scan(): Promise<string[]> {
    const seen = new Set<string>()
    const changed: string[] = []
    let folders: string[]
    try {
      folders = await readdir(this.root)
    } catch {
      folders = [] // no sessions yet: an empty pit wall, not an error
    }
    for (const folder of folders) {
      const dir = path.join(this.root, folder)
      let names: string[]
      try {
        names = await readdir(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!SESSION_FILE.test(name)) continue
        const id = name.slice(0, -'.jsonl'.length)
        seen.add(id)
        if (await this.restat(id, folder, path.join(dir, name))) changed.push(id)
      }
    }
    for (const id of [...this.files.keys()]) {
      if (!seen.has(id)) {
        this.files.delete(id)
        this.facts.delete(id)
        this.readers.delete(id)
        changed.push(id)
      }
    }
    return changed
  }

  /** Re-checks only the sessions that changed recently. Cheap enough to run every second. */
  async scanRecent(): Promise<string[]> {
    const since = this.clock() - RECENT_MS
    const changed: string[] = []
    for (const f of this.files.values()) {
      if (f.mtimeMs >= since && (await this.restat(f.id, f.projectId, f.file))) changed.push(f.id)
    }
    return changed
  }

  private async restat(id: string, projectId: string, file: string): Promise<boolean> {
    let s
    try {
      s = await stat(file)
    } catch {
      return false
    }
    const known = this.files.get(id)
    if (known && known.size === s.size && known.mtimeMs === s.mtimeMs) return false
    this.files.set(id, { id, projectId, file, size: s.size, mtimeMs: s.mtimeMs })
    return true
  }

  async overview(): Promise<Omit<Overview, 'root' | 'demo' | 'talk'>> {
    const all = await this.allSessions()
    const summaries = all.map((e) => e.summary)
    const byProject = new Map<string, SessionSummary[]>()
    for (const s of summaries) {
      const list = byProject.get(s.projectId) ?? []
      list.push(s)
      byProject.set(s.projectId, list)
    }
    const projects = await Promise.all([...byProject.entries()].map(([id, list]) => this.projectWithGit(id, list)))
    projects.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    const names = new Map(projects.map((p) => [p.id, p.name]))

    const recent: ActivityItem[] = all
      .flatMap(({ info, facts }) =>
        facts.recent.map((s) => ({
          sessionId: info.id,
          projectId: info.projectId,
          project: names.get(info.projectId) ?? '',
          session: facts.title,
          kind: s.kind,
          title: s.title,
          at: s.at,
          failed: s.failed,
        })),
      )
      .filter((a) => a.at)
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, FEED_ITEMS)

    const live = summaries.filter((s) => s.status !== 'idle').sort(byUrgency)
    const earlier = summaries
      .filter((s) => s.status === 'idle')
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
      .slice(0, EARLIER_ITEMS)
    const count = (st: SessionStatus) => summaries.filter((s) => s.status === st).length
    const weekAgo = new Date(this.clock() - 7 * DAY_MS).toISOString()
    return {
      projects,
      live,
      earlier,
      recent,
      counts: {
        working: count('working'),
        waiting: count('waiting'),
        yourTurn: count('your-turn'),
        activeProjects: projects.filter((p) => p.lastAt >= weekAgo).length,
      },
    }
  }

  async project(id: string): Promise<{ project: Project; sessions: SessionSummary[] } | undefined> {
    const sessions = (await this.allSessions()).map((e) => e.summary).filter((s) => s.projectId === id)
    if (!sessions.length) return undefined
    sessions.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    return { project: await this.projectWithGit(id, sessions), sessions }
  }

  private async projectWithGit(id: string, sessions: SessionSummary[]): Promise<Project> {
    const p = this.projectOf(id, sessions)
    const uncommitted = await uncommittedFiles(p.path, this.clock())
    return uncommitted === undefined ? p : { ...p, uncommitted }
  }

  /**
   * The steps of one session. With `after`, only steps numbered `after` or higher
   * (what changed since the page last asked); otherwise the latest steps.
   */
  async session(id: string, after?: number): Promise<SessionDetail | undefined> {
    const info = this.files.get(id)
    if (!info) return undefined
    const reader = this.reader(info)
    await reader.refresh()
    const facts = await this.factsOf(info)

    const all = reader.parser.steps
    const steps = after === undefined ? all.slice(-FIRST_STEPS) : all.filter((s) => s.n >= after)
    const firstShown = steps[0]?.n ?? Infinity
    // The opened window may start mid-session; the start time comes from the file's head.
    const meta: SessionMeta = { ...reader.parser.meta, startedAt: facts?.meta.startedAt ?? reader.parser.meta.startedAt }
    const title = facts?.title ?? titleOf(meta)
    const project = this.projectOf(info.projectId, [])
    return {
      summary: this.summaryOf(info, { meta, title, pending: reader.parser.pending, lastAgentText: lastAgentText(all), recent: [] }),
      project: { id: project.id, name: project.name, path: project.path },
      steps,
      hasEarlier: reader.windowStart > 0 || (all[0] !== undefined && all[0].n < firstShown),
      partial: reader.windowStart > 0,
      files: filesTouched(all),
      commands: {
        total: all.filter((s) => s.kind === 'run').length,
        failed: all.filter((s) => s.kind === 'run' && s.failed).length,
      },
    }
  }

  /** What Talk needs to know before it continues a session: where it runs and whether it is busy elsewhere. */
  async sessionInfo(id: string): Promise<{ status: SessionStatus; cwd?: string; projectId: string } | undefined> {
    const info = this.files.get(id)
    if (!info) return undefined
    const facts = await this.factsOf(info)
    if (!facts) return undefined
    return { status: this.summaryOf(info, facts).status, cwd: facts.meta.cwd, projectId: info.projectId }
  }

  /** Whether a session file is known (after a scan). */
  has(id: string): boolean {
    return this.files.has(id)
  }

  /** A picture from an opened session: a screenshot the agent read, or an image you sent. */
  picture(sessionId: string, stepId: string, k: number): Picture | undefined {
    return this.readers.get(sessionId)?.parser.pictures.get(stepId)?.[k]
  }

  /** Steps before step `before`, reading an earlier part of the file if needed. */
  async earlier(id: string, before: number, limit = FIRST_STEPS): Promise<{ steps: Step[]; hasEarlier: boolean } | undefined> {
    const info = this.files.get(id)
    if (!info) return undefined
    const reader = this.reader(info)
    await reader.refresh()
    let older = reader.parser.steps.filter((s) => s.n < before)
    while (older.length < limit && reader.windowStart > 0) {
      await reader.loadEarlier()
      older = reader.parser.steps.filter((s) => s.n < before)
    }
    const steps = older.slice(-limit)
    return { steps, hasEarlier: reader.windowStart > 0 || older.length > steps.length }
  }

  private reader(info: SessionFile): SessionReader {
    let r = this.readers.get(info.id)
    if (r) this.readers.delete(info.id) // re-insert below: most recently used last
    else r = new SessionReader(info.file, this.windowBytes)
    this.readers.set(info.id, r)
    while (this.readers.size > MAX_OPEN_READERS) this.readers.delete(this.readers.keys().next().value!)
    return r
  }

  private async allSessions(): Promise<{ info: SessionFile; facts: Facts; summary: SessionSummary }[]> {
    const out: { info: SessionFile; facts: Facts; summary: SessionSummary }[] = []
    for (const info of this.files.values()) {
      const facts = await this.factsOf(info)
      if (facts) out.push({ info, facts, summary: this.summaryOf(info, facts) })
    }
    return out
  }

  private factsOf(info: SessionFile): Promise<Facts | null> {
    const cached = this.facts.get(info.id)
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.facts
    const entry: CachedFacts = { size: info.size, mtimeMs: info.mtimeMs, facts: readFacts(info).catch(() => null) }
    entry.facts.then((f) => (entry.done = f))
    this.facts.set(info.id, entry)
    return entry.facts
  }

  private summaryOf(info: SessionFile, facts: Facts): SessionSummary {
    const { meta } = facts
    const lastAt = new Date(info.mtimeMs).toISOString()
    const { status, now } = statusOf(meta.last, facts.pending, facts.lastAgentText, this.clock() - info.mtimeMs)
    return {
      id: info.id,
      projectId: info.projectId,
      title: facts.title,
      status,
      now,
      startedAt: meta.startedAt,
      lastAt,
      model: meta.model,
      branch: meta.branch,
      linesAdded: meta.linesAdded,
      linesRemoved: meta.linesRemoved,
      costUSD: meta.costUSD,
      tokens: meta.tokens,
      plan: meta.plan,
      sizeBytes: info.size,
    }
  }

  private projectOf(id: string, sessions: SessionSummary[]): Project {
    const cwd = this.cwdOf(id)
    const projectPath = cwd ?? guessPath(id)
    const newest = sessions.reduce<SessionSummary | undefined>((a, s) => (!a || s.lastAt > a.lastAt ? s : a), undefined)
    return {
      id,
      name: path.basename(projectPath) || projectPath,
      path: projectPath,
      branch: newest?.branch,
      sessions: sessions.length,
      working: sessions.filter((s) => s.status === 'working').length,
      waiting: sessions.filter((s) => s.status === 'waiting').length,
      lastAt: newest?.lastAt ?? '',
      activity: activityByDay(sessions, this.clock()),
    }
  }

  /** The real folder of a project comes from the sessions (`cwd`); the folder name alone is ambiguous. */
  private cwdOf(projectId: string): string | undefined {
    let best: { at: number; cwd: string } | undefined
    for (const info of this.files.values()) {
      if (info.projectId !== projectId) continue
      const cwd = this.facts.get(info.id)?.done?.meta.cwd
      if (cwd && (!best || info.mtimeMs > best.at)) best = { at: info.mtimeMs, cwd }
    }
    return best?.cwd
  }
}

/** Reads the head and tail of a session file (or all of it, when small). */
async function readFacts(info: SessionFile): Promise<Facts | null> {
  const head = new Parser()
  const tail = new Parser()
  if (info.size <= HEAD_BYTES + TAIL_BYTES) {
    tail.feedAll((await readLines(info.file, 0, info.size)).lines)
  } else {
    head.feedAll((await readLines(info.file, 0, HEAD_BYTES)).lines)
    tail.feedAll((await readLines(info.file, info.size - TAIL_BYTES, info.size)).lines)
  }
  const meta: SessionMeta = {
    ...tail.meta,
    startedAt: head.meta.startedAt ?? tail.meta.startedAt,
    firstPrompt: head.meta.firstPrompt ?? tail.meta.firstPrompt,
    customTitle: tail.meta.customTitle ?? head.meta.customTitle,
    aiTitle: tail.meta.aiTitle ?? head.meta.aiTitle,
    cwd: tail.meta.cwd ?? head.meta.cwd,
  }
  if (!head.steps.length && !tail.steps.length && !meta.customTitle && !meta.aiTitle) return null
  const recent = tail.steps.filter((s) => FEED_KINDS.has(s.kind)).slice(-FEED_PER_SESSION)
  return { meta, title: titleOf(meta), pending: tail.pending, lastAgentText: lastAgentText(tail.steps), recent }
}

/**
 * How many sessions were active on each of the last 7 days (local time), today last.
 * A session counts on every day between its first and its last write.
 */
export function activityByDay(sessions: Pick<SessionSummary, 'startedAt' | 'lastAt'>[], now: number): number[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const days = Array.from({ length: 7 }, (_, i) => {
    const start = new Date(today)
    start.setDate(today.getDate() - (6 - i))
    const end = new Date(start)
    end.setDate(start.getDate() + 1)
    return { start: start.getTime(), end: end.getTime() }
  })
  return days.map(({ start, end }) =>
    sessions.filter((s) => {
      const last = Date.parse(s.lastAt)
      const first = s.startedAt ? Date.parse(s.startedAt) : last
      return first < end && last >= start
    }).length,
  )
}

function titleOf(meta: SessionMeta): string {
  return clip(meta.customTitle ?? meta.aiTitle ?? meta.firstPrompt ?? 'Untitled session', 120)
}

function lastAgentText(steps: Step[]): string | undefined {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i]!.kind === 'agent') return steps[i]!.title
  return undefined
}

function guessPath(folder: string): string {
  return folder.startsWith('-') ? folder.replace(/-/g, '/') : folder
}

const URGENCY: Record<SessionStatus, number> = { waiting: 0, working: 1, 'your-turn': 2, idle: 3 }
const byUrgency = (a: SessionSummary, b: SessionSummary) => URGENCY[a.status] - URGENCY[b.status] || b.lastAt.localeCompare(a.lastAt)

function filesTouched(steps: Step[]): FileTouched[] {
  const files = new Map<string, FileTouched>()
  for (const s of steps) {
    // Only changes that happened: a refused or still-waiting edit changed nothing.
    if ((s.kind !== 'edit' && s.kind !== 'write') || !s.path || s.failed || s.pending) continue
    const f = files.get(s.path) ?? { path: s.path, added: 0, removed: 0, created: false, edits: 0 }
    f.added += s.added ?? 0
    f.removed += s.removed ?? 0
    f.edits++
    if (s.title.startsWith('Created ')) f.created = true
    files.set(s.path, f)
  }
  return [...files.values()].sort((a, b) => b.added + b.removed - (a.added + a.removed))
}

/** An opened session: the latest part of its file, kept up to date as the agent writes. */
class SessionReader {
  parser = new Parser(0, true)
  windowStart = 0
  private readTo = 0
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly windowBytes: number,
  ) {}

  /** One read at a time, so two page requests never feed the same lines twice. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.catch(() => undefined)
    return run
  }

  refresh(): Promise<void> {
    return this.serial(async () => {
      let size: number
      try {
        size = (await stat(this.file)).size
      } catch {
        return
      }
      if (size < this.readTo) {
        // The file was replaced or cut: start over.
        this.parser = new Parser(0, true)
        this.readTo = 0
        this.windowStart = 0
      }
      if (size === this.readTo) return
      const first = this.readTo === 0
      const start = first ? Math.max(0, size - this.windowBytes) : this.readTo
      const chunk = await readLines(this.file, start, size)
      if (first) this.windowStart = chunk.lines.length ? chunk.firstLineAt : 0
      this.parser.feedAll(chunk.lines)
      this.readTo = chunk.readTo
    })
  }

  loadEarlier(): Promise<void> {
    return this.serial(async () => {
      let start = this.windowStart
      while (start > 0) {
        start = Math.max(0, start - this.windowBytes)
        const chunk = await readLines(this.file, start, this.windowStart)
        if (!chunk.lines.length && start > 0) continue // one line longer than the window: read further back
        const earlier = new Parser(0, true)
        earlier.feedAll(chunk.lines)
        this.parser.prepend(earlier)
        this.windowStart = chunk.lines.length ? chunk.firstLineAt : 0
        return
      }
      this.windowStart = 0
    })
  }
}
