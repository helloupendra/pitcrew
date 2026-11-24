import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Overview, SessionSummary } from '../../../src/core/types'
import { get, serialLoader, useChanges } from '../api'
import { ago, STATUS_WORD } from '../format'
import { useNow } from '../parts/ui'

const REFRESH_MS = 10_000

/** The pit lane: every agent that is out right now, each in its own box. */
export function LanePage({ onError }: { onError: (e: unknown) => void }) {
  const [data, setData] = useState<Overview>()
  const now = useNow()
  const load = useMemo(() => serialLoader(() => get<Overview>('/api/overview').then(setData, onError)), [onError])
  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])
  useChanges(useCallback(() => load(), [load]))

  if (!data) return <p className="muted pad">Loading…</p>
  const names = new Map(data.projects.map((p) => [p.id, p.name]))

  return (
    <div className="page">
      <header className="head">
        <h1>Pit lane</h1>
        <p className="muted">Every agent out right now. Moving crew means working; an amber light means it waits for you.</p>
      </header>
      {data.live.length ? (
        <ol className="lane">
          {data.live.map((s, i) => (
            <PitBox key={s.id} s={s} box={i + 1} project={names.get(s.projectId) ?? ''} now={now} />
          ))}
        </ol>
      ) : (
        <p className="muted lane-empty">The pit lane is quiet: no agent is out right now.</p>
      )}
    </div>
  )
}

function PitBox({ s, box, project, now }: { s: SessionSummary; box: number; project: string; now: number }) {
  return (
    <li>
      <a className={`pitbox pitbox-${s.status}`} href={`#/s/${s.id}`}>
        <span className="pitbox-top">
          <span className="pitbox-no">{String(box).padStart(2, '0')}</span>
          <span className="pitbox-light" aria-hidden="true" />
          <span className="pitbox-state">{STATUS_WORD[s.status]}</span>
        </span>
        <span className="pitbox-crew" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="name clamp-2">{s.title}</span>
        <span className="muted small clamp-2">
          {project} · {s.now}
        </span>
        <span className="muted small">{ago(s.lastAt, now)}</span>
      </a>
    </li>
  )
}
