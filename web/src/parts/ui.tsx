import { useEffect, useState } from 'react'
import type { PlanItem, SessionStatus } from '../../../src/core/types'
import { STATUS_WORD } from '../format'

/** The shape that goes with a status word: a solid dot (waiting), moving marks (working), a ring (your turn), a small dot (idle). */
export function Glyph({ status }: { status: SessionStatus }) {
  if (status === 'working') {
    return (
      <span className="g g-working" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    )
  }
  return <span className={`g g-${status}`} aria-hidden="true" />
}

/** A status is always a word; the shape only helps the eye. */
export function Status({ status }: { status: SessionStatus }) {
  return (
    <span className={`status status-${status}`}>
      <Glyph status={status} />
      {STATUS_WORD[status]}
    </span>
  )
}

/** The current time, ticking, so "12s ago" stays true without new data. */
export function useNow(everyMs = 5_000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

export function Plan({ items }: { items: PlanItem[] }) {
  return (
    <ol className="plan">
      {items.map((p, i) => (
        <li key={i} className={`plan-${p.status}`}>
          <span aria-hidden="true">{p.status === 'completed' ? '✓' : p.status === 'in_progress' ? '›' : '·'}</span>
          <span>
            {p.text}
            {p.status === 'in_progress' ? <span className="sr"> (in progress)</span> : p.status === 'completed' ? <span className="sr"> (done)</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function Changes({ added, removed }: { added?: number; removed?: number }) {
  if (!added && !removed) return null
  return (
    <span className="chg">
      {added ? <span className="plus">+{added}</span> : null}
      {removed ? <span className="minus">−{removed}</span> : null}
    </span>
  )
}

/** "3 of 5" with one segment per plan step: how far through its own plan the agent is. */
export function PlanProgress({ items }: { items: PlanItem[] }) {
  const done = items.filter((p) => p.status === 'completed').length
  return (
    <span className="prog" title={items.find((p) => p.status === 'in_progress')?.text}>
      <span className="seg" aria-hidden="true">
        {items.map((p, i) => (
          <i key={i} className={p.status === 'completed' ? 'd' : p.status === 'in_progress' ? 'c' : undefined} />
        ))}
      </span>
      {done} of {items.length}
    </span>
  )
}

/** Seven small bars: sessions active on each of the last seven days, today last. */
export function Activity({ days, now }: { days: number[]; now: number }) {
  const max = Math.max(1, ...days)
  const label = (i: number) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (days.length - 1 - i))
    const day = i === days.length - 1 ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    return `${day}: ${days[i]} ${days[i] === 1 ? 'session' : 'sessions'}`
  }
  return (
    <span className="act" role="img" aria-label={`Sessions per day, last 7 days: ${days.join(', ')}`}>
      {days.map((n, i) => (
        <i
          key={i}
          className={!n ? 'o' : i === days.length - 1 ? 't' : undefined}
          style={n ? { height: `${Math.max(22, (n / max) * 100)}%` } : undefined}
          title={label(i)}
        />
      ))}
    </span>
  )
}

export function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="message">
      <h2>{title}</h2>
      {children}
    </div>
  )
}

/** The small Pitcrew mark: two solid squares on a diagonal, two faint ones. */
export function Mark() {
  return (
    <svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect width="6" height="6" rx="1" />
      <rect x="8" y="8" width="6" height="6" rx="1" />
      <rect x="8" width="6" height="6" rx="1" opacity=".3" />
      <rect y="8" width="6" height="6" rx="1" opacity=".3" />
    </svg>
  )
}
