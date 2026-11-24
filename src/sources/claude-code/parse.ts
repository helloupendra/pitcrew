import { addedLines, countChanges, lineDiff, patchToDiff } from '../../core/diff.js'
import type { PlanItem, Step } from '../../core/types.js'

/**
 * Reads Claude Code session files (~/.claude/projects/<folder>/<session>.jsonl).
 *
 * Each line is one JSON object. The ones that matter here:
 *   user       a message you sent, or the result of a tool the agent ran
 *   assistant  one content block of the agent's reply: text, thinking or tool_use
 *   system     things like "the conversation was compacted"
 *   ai-title / custom-title / cost-state   the session's title and running totals
 * Everything else (request logs, snapshots, account lines) is skipped without
 * being parsed, and nothing read here ever leaves the machine.
 */

const TEXT_MAX = 6_000
const OUTPUT_MAX = 4_000
/** Pictures kept for an opened session; the oldest go first. Listing sessions keeps none. */
const PICTURE_BUDGET = 24 * 1024 * 1024
const PICTURE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export interface Picture {
  type: string
  /** base64 */
  data: string
}

/** Line types that are only bookkeeping. They start with {"type":"…" so they can be skipped unparsed. */
const KEEP_TYPED = new Set(['ai-title', 'custom-title', 'cost-state', 'summary', 'user', 'assistant', 'system'])
const TYPED_PREFIX = /^\{"type":"([^"]+)"/

export type LastEvent =
  | { kind: 'prompt' } // you sent something; the agent is on it
  | { kind: 'tool-result' } // a tool finished; the agent is on it
  | { kind: 'tool' } // the agent called a tool and is waiting for it
  | { kind: 'agent-text'; final: boolean }
  | { kind: 'stopped'; why: 'you' | 'error' }

export interface SessionMeta {
  cwd?: string
  branch?: string
  model?: string
  aiTitle?: string
  customTitle?: string
  firstPrompt?: string
  startedAt?: string
  lastAt?: string
  linesAdded?: number
  linesRemoved?: number
  /** Claude Code's own running estimate, at API prices, and the tokens behind it. */
  costUSD?: number
  tokens?: number
  plan?: PlanItem[]
  last?: LastEvent
}

interface ToolResult {
  content: unknown
  isError: boolean
  extra: Record<string, unknown> | undefined
  at: string
}

type Json = Record<string, unknown>

export class Parser {
  readonly steps: Step[] = []
  readonly meta: SessionMeta = {}
  /** Tool calls still waiting for their result, by tool_use id. */
  private readonly open = new Map<string, Step>()
  /** Results whose call lies before the part of the file that was read. */
  readonly orphans = new Map<string, ToolResult>()
  /** Pictures by step id, when kept. */
  readonly pictures = new Map<string, Picture[]>()
  private pictureBytes = 0
  private seq: number

  constructor(
    firstSeq = 0,
    private readonly keepPictures = false,
  ) {
    this.seq = firstSeq
  }

  private keep(stepId: string, blocks: unknown): number {
    const found = picturesIn(blocks)
    if (!found.length || !this.keepPictures) return found.length
    this.pictures.set(stepId, found)
    this.pictureBytes += found.reduce((n, p) => n + p.data.length, 0)
    for (const [id, pics] of this.pictures) {
      if (this.pictureBytes <= PICTURE_BUDGET) break
      this.pictures.delete(id)
      this.pictureBytes -= pics.reduce((n, p) => n + p.data.length, 0)
    }
    return found.length
  }

  get pending(): Step[] {
    return [...this.open.values()]
  }

  feedAll(lines: Iterable<string>): void {
    for (const line of lines) this.feed(line)
  }

  feed(raw: string): void {
    if (!raw || raw.length < 2) return
    const typed = TYPED_PREFIX.exec(raw)
    if (typed && !KEEP_TYPED.has(typed[1]!)) return
    let line: Json
    try {
      line = JSON.parse(raw) as Json
    } catch {
      return // a broken line never stops the rest of the session from showing
    }
    this.line(line)
  }

  private line(line: Json): void {
    switch (line.type) {
      case 'ai-title':
        if (typeof line.aiTitle === 'string') this.meta.aiTitle = line.aiTitle
        return
      case 'custom-title':
        if (typeof line.customTitle === 'string') this.meta.customTitle = line.customTitle
        return
      case 'cost-state':
        if (typeof line.totalLinesAdded === 'number') this.meta.linesAdded = line.totalLinesAdded
        if (typeof line.totalLinesRemoved === 'number') this.meta.linesRemoved = line.totalLinesRemoved
        if (typeof line.totalCostUSD === 'number') this.meta.costUSD = line.totalCostUSD
        if (isObject(line.modelUsage)) this.meta.tokens = tokensOf(line.modelUsage)
        return
      case 'user':
      case 'assistant':
      case 'system':
        break
      default:
        return
    }
    if (line.isSidechain === true) return // helper-agent lines live in their own files

    const at = typeof line.timestamp === 'string' ? line.timestamp : ''
    if (at) {
      this.meta.startedAt ??= at
      this.meta.lastAt = at
    }
    if (typeof line.cwd === 'string') this.meta.cwd = line.cwd
    if (typeof line.gitBranch === 'string' && line.gitBranch) this.meta.branch = line.gitBranch

    if (line.type === 'user') this.user(line, at)
    else if (line.type === 'assistant') this.assistant(line, at)
    else this.system(line, at)
  }

  private user(line: Json, at: string): void {
    if (line.isMeta === true) return
    const message = line.message as Json | undefined
    const content = message?.content
    const uuid = String(line.uuid ?? `u${this.seq}`)

    if (line.isCompactSummary === true) {
      this.add({ id: uuid, kind: 'note', at, title: 'The conversation was summarized to make room', text: clip(textOf(content), TEXT_MAX) })
      return
    }

    if (typeof content === 'string') {
      this.prompt(uuid, at, content, 0)
      return
    }
    if (!Array.isArray(content)) return

    const texts: string[] = []
    let images = 0
    for (const block of content as Json[]) {
      if (block?.type === 'tool_result') {
        this.keep(String(block.tool_use_id), block.content)
        this.result(String(block.tool_use_id), {
          content: block.content,
          isError: block.is_error === true,
          extra: isObject(line.toolUseResult) ? line.toolUseResult : undefined,
          at,
        })
      } else if (block?.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text)
      } else if (block?.type === 'image') {
        images++
      }
    }
    const shown = images ? this.keep(uuid, content) : 0
    if (texts.length || images) this.prompt(uuid, at, texts.join('\n\n'), images, shown)
  }

  /** `images` is how many the message had; `shown` how many of them a browser can show. */
  private prompt(id: string, at: string, raw: string, images: number, shown = 0): void {
    if (raw.trimStart().startsWith('[Request interrupted by user')) {
      this.add({ id, kind: 'note', at, title: 'You stopped the agent' })
      this.meta.last = { kind: 'stopped', why: 'you' }
      return
    }
    const notice = /<task-notification>[\s\S]*?<\/task-notification>/.exec(raw)
    if (notice && !cleanPrompt(raw.replace(notice[0], ''))) {
      const summary = /<summary>([\s\S]*?)<\/summary>/.exec(notice[0])?.[1]?.trim()
      this.add({ id, kind: 'note', at, title: summary ? clip(oneLine(summary), 140) : 'A background task finished' })
      this.meta.last = { kind: 'prompt' }
      return
    }
    let text = cleanPrompt(raw)
    if (images) text = [text, images === 1 ? '(an image)' : `(${images} images)`].filter(Boolean).join('\n')
    if (!text) return
    this.meta.firstPrompt ??= clip(oneLine(text), 200)
    this.add({ id, kind: 'you', at, title: clip(oneLine(text), 140), text: clip(text, TEXT_MAX), ...(shown ? { images: shown } : {}) })
    this.meta.last = { kind: 'prompt' }
  }

  private assistant(line: Json, at: string): void {
    const message = line.message as Json | undefined
    if (!message) return
    if (typeof message.model === 'string' && !message.model.startsWith('<')) this.meta.model = message.model
    const final = message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence' || message.stop_reason === 'max_tokens'
    const uuid = String(line.uuid ?? `a${this.seq}`)
    const blocks = Array.isArray(message.content) ? (message.content as Json[]) : []

    if (line.isApiErrorMessage === true) {
      this.add({ id: uuid, kind: 'note', at, title: 'The model request failed', text: clip(textOf(blocks), TEXT_MAX), failed: true })
      this.meta.last = { kind: 'stopped', why: 'error' }
      return
    }

    blocks.forEach((block, i) => {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        const text = block.text.trim()
        this.add({ id: `${uuid}:${i}`, kind: 'agent', at, title: clip(oneLine(text), 140), text: clip(text, TEXT_MAX) })
        this.meta.last = { kind: 'agent-text', final }
      } else if (block?.type === 'tool_use') {
        const id = String(block.id ?? `${uuid}:${i}`)
        const input = isObject(block.input) ? block.input : {}
        const step = this.add({ id, at, pending: true, ...describeTool(String(block.name ?? 'tool'), input, this.meta.cwd) })
        if (step.plan) this.meta.plan = step.plan
        const early = this.orphans.get(id)
        if (early) {
          this.orphans.delete(id)
          applyResult(step, early)
        } else {
          this.open.set(id, step)
          this.meta.last = { kind: 'tool' }
        }
      }
    })
  }

  private system(line: Json, at: string): void {
    if (line.subtype === 'compact_boundary') {
      this.add({ id: String(line.uuid ?? `s${this.seq}`), kind: 'note', at, title: 'Context was compacted' })
    }
  }

  private result(toolUseId: string, result: ToolResult): void {
    const step = this.open.get(toolUseId)
    if (!step) {
      this.orphans.set(toolUseId, result)
      return
    }
    this.open.delete(toolUseId)
    applyResult(step, result)
    this.meta.last = { kind: 'tool-result' }
  }

  private add(step: Omit<Step, 'n'>): Step {
    const full = { n: this.seq++, ...step } as Step
    this.steps.push(full)
    return full
  }

  /**
   * Puts an earlier part of the same file in front of this one. `earlier` was
   * parsed on its own; its steps are renumbered to come before ours, and its
   * open tool calls take the results this parser could not match.
   */
  prepend(earlier: Parser): Step[] {
    const firstN = (this.steps[0]?.n ?? this.seq) - earlier.steps.length
    earlier.steps.forEach((s, i) => (s.n = firstN + i))
    for (const [id, step] of earlier.open) {
      const result = this.orphans.get(id)
      if (result) {
        this.orphans.delete(id)
        applyResult(step, result)
      }
    }
    for (const [id, r] of earlier.orphans) this.orphans.set(id, r)
    this.steps.unshift(...earlier.steps)
    for (const [id, pics] of earlier.pictures) if (!this.pictures.has(id)) this.pictures.set(id, pics)
    this.meta.startedAt = earlier.meta.startedAt ?? this.meta.startedAt
    this.meta.firstPrompt = earlier.meta.firstPrompt ?? this.meta.firstPrompt
    this.meta.plan ??= earlier.meta.plan
    this.meta.customTitle ??= earlier.meta.customTitle
    this.meta.aiTitle ??= earlier.meta.aiTitle
    return earlier.steps
  }
}

type StepShape = Pick<Step, 'kind' | 'title'> & Partial<Step>

/** Says in plain words what a tool call does. */
export function describeTool(name: string, input: Json, cwd?: string): StepShape {
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const file = (k: string): { path: string; short: string } => {
    const path = str(k)
    return { path, short: shortPath(path, cwd) }
  }

  switch (name) {
    case 'Bash': {
      const command = str('command')
      const what = str('description') || clip(oneLine(command), 100) || 'a command'
      return { kind: 'run', title: input.run_in_background === true ? `${what} (in the background)` : what, command: clip(command, TEXT_MAX) }
    }
    case 'Read': {
      const f = file('file_path')
      return { kind: 'read', title: `Read ${f.short}`, path: f.path }
    }
    case 'Edit': {
      const f = file('file_path')
      const diff = lineDiff(str('old_string'), str('new_string'))
      return { kind: 'edit', title: `Edited ${f.short}`, path: f.path, diff, ...countChanges(diff) }
    }
    case 'MultiEdit': {
      const f = file('file_path')
      const edits = Array.isArray(input.edits) ? (input.edits as Json[]) : []
      const diff = edits.flatMap((e, i) => [
        ...(i ? [{ t: '~' as const, s: '' }] : []),
        ...lineDiff(String(e.old_string ?? ''), String(e.new_string ?? '')),
      ])
      return { kind: 'edit', title: `Edited ${f.short}`, path: f.path, diff, ...countChanges(diff) }
    }
    case 'Write': {
      const f = file('file_path')
      const diff = addedLines(str('content'))
      return { kind: 'write', title: `Wrote ${f.short}`, path: f.path, diff, ...countChanges(diff) }
    }
    case 'NotebookEdit': {
      const f = file('notebook_path')
      return { kind: 'edit', title: `Edited ${f.short}`, path: f.path }
    }
    case 'Grep': {
      const where = str('path') ? ` in ${shortPath(str('path'), cwd)}` : ''
      return { kind: 'search', title: `Searched for “${clip(str('pattern'), 60)}”${where}` }
    }
    case 'Glob':
      return { kind: 'search', title: `Looked for files ${clip(str('pattern'), 60)}` }
    case 'LS':
      return { kind: 'read', title: `Listed ${shortPath(str('path'), cwd)}`, path: str('path') }
    case 'WebFetch':
      return { kind: 'web', title: `Opened ${clip(str('url').replace(/^https?:\/\//, ''), 90)}` }
    case 'WebSearch':
      return { kind: 'web', title: `Searched the web for “${clip(str('query'), 80)}”` }
    case 'Agent':
    case 'Task': {
      const who = str('subagent_type')
      return { kind: 'helper', title: str('description') || 'Started a helper', text: who && who !== 'general-purpose' ? who : undefined }
    }
    case 'TodoWrite': {
      const plan = readPlan(input.todos)
      const done = plan.filter((p) => p.status === 'completed').length
      return { kind: 'plan', title: `Updated the plan (${done} of ${plan.length} done)`, plan }
    }
    case 'AskUserQuestion': {
      const qs = Array.isArray(input.questions) ? (input.questions as Json[]) : []
      const first = typeof qs[0]?.question === 'string' ? (qs[0].question as string) : 'a question'
      return { kind: 'ask', title: `Asked you: ${clip(first, 120)}` }
    }
    case 'ExitPlanMode':
      return { kind: 'ask', title: 'Asked you to approve a plan', text: clip(str('plan'), TEXT_MAX) }
    case 'Skill':
      return { kind: 'tool', title: `Used the ${str('skill') || 'a'} skill` }
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
      if (mcp) return { kind: 'tool', title: `Used ${mcp[2]} (${mcp[1]})` }
      return { kind: 'tool', title: `Used ${name}` }
    }
  }
}

function applyResult(step: Step, result: ToolResult): void {
  step.pending = false
  step.failed = result.isError || undefined
  const extra = result.extra
  const text = textOf(result.content)
  const pictures = picturesIn(result.content).length
  if (pictures) step.images = pictures

  switch (step.kind) {
    case 'run': {
      const interrupted = extra?.interrupted === true
      step.output = clipTail(text, OUTPUT_MAX)
      if (interrupted) step.failed = true
      break
    }
    case 'edit':
    case 'write': {
      const patch = patchToDiff(extra?.structuredPatch)
      if (step.kind === 'write' && extra?.type === 'create') step.title = step.title.replace(/^Wrote /, 'Created ')
      else if (step.kind === 'write' && extra?.type === 'update') step.title = step.title.replace(/^Wrote /, 'Rewrote ')
      if (patch) {
        step.diff = patch
        Object.assign(step, countChanges(patch))
      }
      if (result.isError) step.output = clip(text, OUTPUT_MAX)
      break
    }
    case 'read':
      if (result.isError) step.output = clip(text, OUTPUT_MAX)
      break
    case 'helper':
    case 'search':
    case 'web':
    case 'tool':
    case 'ask':
      step.output = clip(text, OUTPUT_MAX)
      break
    default:
      break
  }
}

/** Removes what the editor or Claude Code adds around a prompt, keeping what you typed. */
export function cleanPrompt(raw: string): string {
  const command = /<command-name>\s*([^<]*?)\s*<\/command-name>/.exec(raw)
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim()
    const name = command[1]!.startsWith('/') ? command[1]! : `/${command[1]}`
    return args ? `${name} ${args}` : name
  }
  return raw
    .replace(/<(system-reminder|ide_opened_file|ide_selection|local-command-caveat|local-command-stdout|local-command-stderr)\b[^>]*>[\s\S]*?<\/\1>/g, '')
    .replace(/<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content>/g, '$1')
    .trim()
}

/** All tokens across models: input, output, and the cache reads and writes. */
function tokensOf(usage: Json): number {
  let n = 0
  for (const m of Object.values(usage)) {
    if (!isObject(m)) continue
    for (const k of ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens']) {
      if (typeof m[k] === 'number') n += m[k] as number
    }
  }
  return n
}

/** Image blocks (base64) in a message or a tool result, in the types a browser shows. */
function picturesIn(blocks: unknown): Picture[] {
  if (!Array.isArray(blocks)) return []
  const out: Picture[] = []
  for (const b of blocks) {
    if (!isObject(b) || b.type !== 'image' || !isObject(b.source)) continue
    const { media_type: type, data } = b.source
    if (typeof type === 'string' && PICTURE_TYPES.has(type) && typeof data === 'string') out.push({ type, data })
  }
  return out
}

function readPlan(todos: unknown): PlanItem[] {
  if (!Array.isArray(todos)) return []
  return todos
    .filter(isObject)
    .map(
      (t): PlanItem => ({
        text: String(t.content ?? t.activeForm ?? ''),
        status: t.status === 'completed' || t.status === 'in_progress' ? t.status : 'pending',
      }),
    )
    .filter((t) => t.text)
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((b) => {
      if (!isObject(b)) return ''
      if (b.type === 'text' && typeof b.text === 'string') return b.text
      if (b.type === 'image') return '(an image)'
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function shortPath(path: string, cwd?: string): string {
  if (!path) return 'a file'
  if (cwd && path.startsWith(cwd + '/')) return path.slice(cwd.length + 1)
  const home = /^\/(?:Users|home)\/[^/]+\//.exec(path)
  return home ? '~/' + path.slice(home[0].length) : path
}

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

export function clip(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…'
}

function clipTail(s: string, max: number): string {
  if (s.length <= max) return s
  return `… ${s.length - max} earlier characters not shown\n` + s.slice(s.length - max)
}

