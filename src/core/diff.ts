import type { DiffLine } from './types.js'

const MAX_LINES = 400
/** Above this many cells the line-by-line match is skipped and the change is shown as remove + add. */
const MAX_CELLS = 250_000

/** Lines of a snippet; a final newline ends the last line rather than starting an empty one. */
const split = (s: string): string[] => {
  const text = s.replace(/\r\n/g, '\n').replace(/\n$/, '')
  return text === '' && s.length <= 1 ? [] : text.split('\n')
}

/** A line diff between two snippets (longest common subsequence). */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = split(before)
  const b = split(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const head: DiffLine[] = a.slice(0, start).map((s) => ({ t: ' ', s }))
  const tail: DiffLine[] = a.slice(endA).map((s) => ({ t: ' ', s }))
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  return cap([...head, ...middle(midA, midB), ...tail])
}

function middle(a: string[], b: string[]): DiffLine[] {
  if (a.length * b.length > MAX_CELLS) {
    return [...a.map((s) => ({ t: '-' as const, s })), ...b.map((s) => ({ t: '+' as const, s }))]
  }
  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: Uint32Array[] = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lcs[i]!
    const next = lcs[i + 1]!
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ t: ' ', s: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ t: '-', s: a[i++]! })
    } else {
      out.push({ t: '+', s: b[j++]! })
    }
  }
  while (i < a.length) out.push({ t: '-', s: a[i++]! })
  while (j < b.length) out.push({ t: '+', s: b[j++]! })
  return out
}

/** A new file: every line is added. */
export function addedLines(content: string): DiffLine[] {
  return cap(split(content).map((s) => ({ t: '+', s })))
}

interface Hunk {
  lines?: unknown
}

/** Claude Code stores the exact patch it applied; read it when it is there. */
export function patchToDiff(hunks: unknown): DiffLine[] | undefined {
  if (!Array.isArray(hunks) || hunks.length === 0) return undefined
  const out: DiffLine[] = []
  hunks.forEach((h: Hunk, index) => {
    if (!Array.isArray(h?.lines)) return
    if (index > 0) out.push({ t: '~', s: '' })
    for (const raw of h.lines) {
      if (typeof raw !== 'string') continue
      const mark = raw[0]
      out.push({ t: mark === '+' || mark === '-' ? mark : ' ', s: raw.slice(1) })
    }
  })
  return out.length ? cap(out) : undefined
}

export function countChanges(diff: DiffLine[] | undefined): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const l of diff ?? []) {
    if (l.t === '+') added++
    else if (l.t === '-') removed++
  }
  return { added, removed }
}

function cap(lines: DiffLine[]): DiffLine[] {
  if (lines.length <= MAX_LINES) return lines
  const more = lines.length - MAX_LINES
  return [...lines.slice(0, MAX_LINES), { t: '~', s: `${more} more lines not shown` }]
}
