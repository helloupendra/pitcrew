import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionStatus, SessionSummary } from '../../../src/core/types'
import { ago, STATUS_WORD, tilde } from '../format'
import { useOverview } from '../overview'
import { Glyph, useNow } from '../parts/ui'
import { SessionPane } from './SessionPage'

/** The list's groups, most urgent first; idle sessions are "Earlier". */
const GROUPS: [SessionStatus, string][] = [
  ['waiting', 'Waiting for you'],
  ['working', 'Working'],
  ['your-turn', 'Your turn'],
  ['idle', 'Earlier'],
]

/** Below this width the panes become one: the list, then the session with a back link. */
const ONE_PANE = '(max-width: 759px)'

function useOnePane(): boolean {
  const [one, setOne] = useState(() => window.matchMedia(ONE_PANE).matches)
  useEffect(() => {
    const m = window.matchMedia(ONE_PANE)
    const on = () => setOne(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return one
}

/**
 * Sessions, the Paddock way: every session on the left (waiting for you first), the selected one in
 * the middle as a conversation, and its context on the right. j / k move between sessions, a / d
 * answer the permission card on screen, / or ⌘K opens the palette.
 */
export function SessionsView({ id, onError }: { id?: string; onError: (e: unknown) => void }) {
  const data = useOverview(onError)
  const now = useNow()
  const onePane = useOnePane()
  const list = useRef<HTMLElement>(null)

  const names = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, p.name])), [data])
  const groups = useMemo(() => {
    const all = [...(data?.live ?? []), ...(data?.earlier ?? [])]
    return GROUPS.map(([status, label]) => [status, label, all.filter((s) => s.status === status)] as const).filter(([, , ss]) => ss.length)
  }, [data])
  const order = useMemo(() => groups.flatMap(([, , ss]) => ss.map((s) => s.id)), [groups])

  // A wide screen always shows a session: the one in the address, else the most urgent.
  const selected = id ?? (onePane ? undefined : order[0])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('.pal-bg')) return
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'j' || e.key === 'k') {
        if (!order.length) return
        e.preventDefault()
        const at = selected ? order.indexOf(selected) : -1
        const next = order[Math.min(order.length - 1, Math.max(0, at + (e.key === 'j' ? 1 : -1)))]
        if (next && next !== selected) location.hash = `#/s/${next}`
      } else if (e.key === 'a' || e.key === 'd') {
        // Only the card on screen, and only on a key press: nothing is ever answered by itself.
        const button = document.querySelector<HTMLButtonElement>(`.foot .ask [data-answer="${e.key === 'a' ? 'allow' : 'deny'}"]`)
        if (!button || button.disabled) return
        e.preventDefault()
        button.click()
      } else if (e.key === '/') {
        e.preventDefault()
        window.dispatchEvent(new Event('pitcrew:palette'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [order, selected])

  // Keep the selected session in view in the list as j / k move through it.
  useEffect(() => {
    list.current?.querySelector('[aria-current]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!data) return <p className="muted pad">Looking for sessions…</p>

  if (!order.length) {
    return (
      <div className="message">
        <h2>No sessions yet</h2>
        <p>
          Nothing found in <code>{tilde(data.root)}</code>. Start Claude Code in any project and its session shows up here by itself.
        </p>
        <p className="muted">
          Want to look around first? Run <code>npx pitcrew-cli --demo</code>.
        </p>
      </div>
    )
  }

  return (
    <div className={`work ${id ? 'is-sess' : 'is-list'}`}>
      <nav className="list" ref={list} aria-label="Sessions">
        <div className="list-h">
          <h2>Sessions</h2>
        </div>
        {groups.map(([status, label, sessions]) => (
          <section className="grp" key={status}>
            <h3>
              {label}
              <span>{sessions.length}</span>
            </h3>
            <ul>
              {sessions.map((s) => (
                <Item key={s.id} s={s} project={names.get(s.projectId) ?? ''} now={now} current={s.id === selected} />
              ))}
            </ul>
          </section>
        ))}
        <p className="keys">
          <span>
            <kbd>j</kbd> <kbd>k</kbd> move
          </span>
          <span>
            <kbd>a</kbd> allow
          </span>
          <span>
            <kbd>d</kbd> deny
          </span>
          <span>
            <kbd>⌘K</kbd> go to
          </span>
        </p>
      </nav>
      {selected ? <SessionPane key={selected} id={selected} onError={onError} /> : null}
    </div>
  )
}

function Item({ s, project, now, current }: { s: SessionSummary; project: string; now: number; current: boolean }) {
  return (
    <li>
      <a className={`it it-${s.status}`} href={`#/s/${s.id}`} aria-current={current ? 'true' : undefined}>
        <Glyph status={s.status} />
        <span className="it-t">{s.title}</span>
        <span className="it-w">{ago(s.lastAt, now)}</span>
        <span className="it-s">
          {project} · {s.now}
        </span>
        <span className="sr">{STATUS_WORD[s.status]}</span>
      </a>
    </li>
  )
}
