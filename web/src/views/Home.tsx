import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityItem, Overview, Project, SessionSummary } from '../../../src/core/types'
import { get, serialLoader, useChanges } from '../api'
import { ago, plural, tilde } from '../format'
import { Activity, Changes, Message, PlanProgress, Status, useNow } from '../parts/ui'

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
  const { counts } = data
  return (
    <div className="page home">
      <dl className="kpis">
        <Kpi label="Working" value={counts.working} tone={counts.working ? 'working' : undefined} />
        <Kpi label="Waiting for you" value={counts.waiting} tone={counts.waiting ? 'waiting' : undefined} />
        <Kpi label="Your turn" value={counts.yourTurn} tone={counts.yourTurn ? 'your-turn' : undefined} />
        <Kpi label="Projects this week" value={counts.activeProjects} />
      </dl>

      <div className="home-grid">
        <div className="home-main">
          <section>
            <h2 className="section">Live now</h2>
            {data.live.length ? (
              <ul className="cards">
                {data.live.map((s) => (
                  <LiveCard key={s.id} s={s} project={names.get(s.projectId) ?? ''} now={now} />
                ))}
              </ul>
            ) : (
              <p className="muted">No agent is working right now. Sessions show up here the moment they start.</p>
            )}
          </section>

          <section>
            <h2 className="section">Projects</h2>
            <ul className="cards">
              {data.projects.map((p) => (
                <ProjectCard key={p.id} p={p} now={now} />
              ))}
            </ul>
          </section>
        </div>

        <section className="home-feed">
          <h2 className="section">Activity, all projects</h2>
          <Feed items={data.recent} now={now} />
        </section>
      </div>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`kpi${tone ? ` kpi-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function LiveCard({ s, project, now }: { s: SessionSummary; project: string; now: number }) {
  return (
    <li>
      <a className={`card live-card card-${s.status}`} href={`#/s/${s.id}`}>
        <span className="card-top">
          <Status status={s.status} />
          <span className="muted when-ago">{ago(s.lastAt, now)}</span>
        </span>
        <span className="name clamp-2">{s.title}</span>
        <span className="muted small clamp-2">
          {project} · {s.now}
        </span>
        {(s.plan?.length || s.linesAdded || s.linesRemoved) && (
          <span className="card-foot">
            {s.plan?.length ? <PlanProgress items={s.plan} /> : <span />}
            <Changes added={s.linesAdded} removed={s.linesRemoved} />
          </span>
        )}
      </a>
    </li>
  )
}

function ProjectCard({ p, now }: { p: Project; now: number }) {
  const facts = [p.branch, p.uncommitted === undefined ? undefined : p.uncommitted ? `${plural(p.uncommitted, 'uncommitted file')}` : 'nothing uncommitted']
    .filter(Boolean)
    .join(' · ')
  return (
    <li>
      <a className="card project-card" href={`#/p/${encodeURIComponent(p.id)}`}>
        <span className="card-top">
          <span className="name">{p.name}</span>
          <span className="muted when-ago">{ago(p.lastAt, now)}</span>
        </span>
        <span className="muted mono small ellipsis">{tilde(p.path)}</span>
        {facts && <span className="muted small ellipsis">{facts}</span>}
        <span className="card-foot">
          <Activity days={p.activity} now={now} />
          <span className="small">
            {p.working ? <Status status="working" /> : p.waiting ? <Status status="waiting" /> : <span className="muted">{plural(p.sessions, 'session')}</span>}
          </span>
        </span>
      </a>
    </li>
  )
}

const FEED_WORD: Partial<Record<ActivityItem['kind'], string>> = { you: 'You', agent: 'Agent', note: '' }

function Feed({ items, now }: { items: ActivityItem[]; now: number }) {
  if (!items.length) return <p className="muted small">Nothing yet.</p>
  return (
    <ol className="feed">
      {items.map((a, i) => (
        <li key={`${a.sessionId}:${a.at}:${i}`}>
          <a href={`#/s/${a.sessionId}`} className={a.failed ? 'is-failed' : undefined}>
            <span className="feed-meta muted">
              {a.project} · {ago(a.at, now)}
            </span>
            <span className="feed-title">
              {FEED_WORD[a.kind] ? <b>{FEED_WORD[a.kind]}: </b> : null}
              {a.title}
              {a.failed ? <span className="flag flag-failed"> failed</span> : null}
            </span>
          </a>
        </li>
      ))}
    </ol>
  )
}
