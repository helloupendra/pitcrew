import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project, SessionSummary } from '../../../src/core/types'
import { get, serialLoader, useChanges } from '../api'
import { ago, tilde } from '../format'
import { Changes, Status, useNow } from '../parts/ui'

const REFRESH_MS = 10_000

export function ProjectPage({ id, onError }: { id: string; onError: (e: unknown) => void }) {
  const [data, setData] = useState<{ project: Project; sessions: SessionSummary[] }>()
  const now = useNow()

  const load = useMemo(
    () => serialLoader(() => get<{ project: Project; sessions: SessionSummary[] }>(`/api/projects/${encodeURIComponent(id)}`).then(setData, onError)),
    [id, onError],
  )
  useEffect(() => {
    setData(undefined)
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])
  useChanges(useCallback(() => load(), [load]))

  if (!data) return <p className="muted pad">Loading…</p>
  const { project, sessions } = data

  return (
    <div className="page">
      <header className="head">
        <a className="back" href="#/">
          ← All projects
        </a>
        <h1>{project.name}</h1>
        <p className="muted mono small">
          {tilde(project.path)}
          {project.branch ? ` · ${project.branch}` : ''}
        </p>
      </header>

      <ul className="rows">
        {sessions.map((s) => (
          <li key={s.id}>
            <a className="row live" href={`#/s/${s.id}`}>
              <Status status={s.status} />
              <span className="row-main">
                <span className="name">{s.title}</span>
                <span className="muted small">{s.now}</span>
              </span>
              <span className="row-meta">
                <Changes added={s.linesAdded} removed={s.linesRemoved} />
                <span className="muted when-ago">{ago(s.lastAt, now)}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
