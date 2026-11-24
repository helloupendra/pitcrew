import type { SessionStatus } from '../../src/core/types'

export function ago(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Clock time for a step; the date is added when it is not today. */
export function clock(iso: string): string {
  const { date, hm, sec } = clockParts(iso)
  return [date, hm + sec].filter(Boolean).join(' ')
}

/** The same, in parts, so small screens can drop the seconds and the date. */
export function clockParts(iso: string): { date: string; hm: string; sec: string } {
  if (!iso) return { date: '', hm: '', sec: '' }
  const d = new Date(iso)
  const two = (n: number) => String(n).padStart(2, '0')
  const today = new Date().toDateString() === d.toDateString()
  return {
    date: today ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
    hm: `${two(d.getHours())}:${two(d.getMinutes())}`,
    sec: `:${two(d.getSeconds())}`,
  }
}

/** "Today", "Yesterday" or the date, for the line that starts a new day in a timeline. */
export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export function tilde(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
}

export const STATUS_WORD: Record<SessionStatus, string> = {
  working: 'Working',
  waiting: 'Waiting',
  'your-turn': 'Your turn',
  idle: 'Idle',
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
