import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Overview, SessionSummary } from '../../../src/core/types'
import { get, serialLoader, useChanges } from '../api'
import { ago } from '../format'
import { PlanProgress, Status, useNow } from '../parts/ui'

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
        <p>Every agent out right now, one box each. Moving marks mean working; a solid blue dot means it waits for you.</p>
      </header>
      {data.live.length ? (
        <ol className="lane">
          {data.live.map((s, i) => (
            <PitBox key={s.id} s={s} box={i + 1} project={names.get(s.projectId) ?? ''} now={now} />
          ))}
        </ol>
      ) : (
        <p className="empty">The pit lane is quiet: no agent is out right now.</p>
      )}
    </div>
  )
}

function PitBox({ s, box, project, now }: { s: SessionSummary; box: number; project: string; now: number }) {
  return (
    <li className={`box box-${s.status}`}>
      <span className="box-h">
        <span className="box-n">Box {String(box).padStart(2, '0')}</span>
        <span>{project}</span>
      </span>
      <span className="box-st">
        <Status status={s.status} />
      </span>
      <a className="box-t" href={`#/s/${s.id}`}>
        {s.title}
      </a>
      <span className="box-s">{s.now}</span>
      <span className="box-f">
        {s.plan?.length ? <PlanProgress items={s.plan} /> : <span />}
        <span>{ago(s.lastAt, now)}</span>
      </span>
    </li>
  )
}
