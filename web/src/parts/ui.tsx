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

export function Message({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="message">
      <h2>{title}</h2>
      {children}
    </div>
  )
}
