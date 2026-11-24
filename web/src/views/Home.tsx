import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Overview, SessionSummary } from '../../../src/core/types'
import { get, serialLoader, useChanges } from '../api'
import { ago, plural, tilde } from '../format'
import { Message, Status, useNow } from '../parts/ui'

/** Statuses depend on time passing, so the page asks again now and then even with no file changes. */
const REFRESH_MS = 10_000

export function Home({ onError }: { onError: (e: unknown) => void }) {
  const [data, setData] = useState<Overview>()
  const now = useNow()

  const load = useMemo(() => serialLoader(() => get<Overview>('/api/overview').then(setData, onError)), [onError])
  useEffect(() => {
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])
  useChanges(useCallback(() => load(), [load]))

  if (!data) return <p className="muted pad">Looking for sessions…</p>

  if (!data.projects.length) {
    return (
      <Message title="No sessions yet">
        <p>
          Nothing found in <code>{tilde(data.root)}</code>. Start Claude Code in any project and its session shows up here
          by itself.
        </p>
        <p className="muted">
          Want to look around first? Run <code>npx pitcrew --demo</code>.
        </p>
      </Message>
    )
  }

  const names = new Map(data.projects.map((p) => [p.id, p.name]))
  return (
    <div className="page">
      <section>
        <h2 className="section">Live now</h2>
        {data.live.length ? (
          <ul className="rows">
            {data.live.map((s) => (
              <LiveRow key={s.id} s={s} project={names.get(s.projectId) ?? ''} now={now} />
            ))}
          </ul>
        ) : (
          <p className="muted">No agent is working right now. Sessions show up here the moment they start.</p>
        )}
      </section>

      <section>
        <h2 className="section">Projects</h2>
        <ul className="rows">
          {data.projects.map((p) => (
            <li key={p.id}>
              <a className="row project" href={`#/p/${encodeURIComponent(p.id)}`}>
                <span className="row-main">
                  <span className="name">{p.name}</span>
                  <span className="muted mono small">{tilde(p.path)}</span>
                </span>
                <span className="row-meta">
                  {p.working ? <Status status="working" /> : p.waiting ? <Status status="waiting" /> : null}
                  <span className="muted">{plural(p.sessions, 'session')}</span>
                  <span className="muted when-ago">{ago(p.lastAt, now)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function LiveRow({ s, project, now }: { s: SessionSummary; project: string; now: number }) {
  return (
    <li>
      <a className="row live" href={`#/s/${s.id}`}>
        <Status status={s.status} />
        <span className="row-main">
          <span className="name">{s.title}</span>
          <span className="muted small">
            {project} · {s.now}
          </span>
        </span>
        <span className="muted when-ago">{ago(s.lastAt, now)}</span>
      </a>
    </li>
  )
}
