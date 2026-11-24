import { useEffect, useState } from 'react'
import type { PlanItem, SessionStatus } from '../../../src/core/types'
import { STATUS_WORD } from '../format'

/** A status is always a word; the dot only helps the eye. */
export function Status({ status }: { status: SessionStatus }) {
  return (
    <span className={`status status-${status}`}>
      <span className="dot" aria-hidden="true" />
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
          <span className="plan-mark" aria-hidden="true">
            {p.status === 'completed' ? '✓' : p.status === 'in_progress' ? '›' : '·'}
          </span>
          <span>{p.text}</span>
          {p.status === 'in_progress' && <span className="sr">(in progress)</span>}
        </li>
      ))}
    </ol>
  )
}

export function Changes({ added, removed }: { added?: number; removed?: number }) {
  if (!added && !removed) return null
  return (
    <span className="changes">
      {added ? <span className="plus">+{added}</span> : null}
      {removed ? <span className="minus">−{removed}</span> : null}
    </span>
  )
}

/** "3 of 5" with a thin bar: how far through its own plan the agent is. */
export function PlanProgress({ items }: { items: PlanItem[] }) {
  const done = items.filter((p) => p.status === 'completed').length
  return (
    <span className="progress" title={items.find((p) => p.status === 'in_progress')?.text}>
      <span className="progress-bar" aria-hidden="true">
        <span style={{ width: `${(done / items.length) * 100}%` }} />
      </span>
      <span className="small muted">
        {done} of {items.length}
      </span>
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
    <span className="activity" role="img" aria-label={`Sessions per day, last 7 days: ${days.join(', ')}`}>
      {days.map((n, i) => (
        <span key={i} className={`activity-day${i === days.length - 1 ? ' today' : ''}`} title={label(i)}>
          <span style={{ height: n ? `${Math.max(18, (n / max) * 100)}%` : '0' }} />
        </span>
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
