import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ActivityItem, Overview, Project, SessionStatus, SessionSummary } from '../../../src/core/types'
import { get, serialLoader, useChanges } from '../api'
import { ago, plural, tilde } from '../format'
import { Activity, Changes, Glyph, Message, PlanProgress, Status, useNow } from '../parts/ui'

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
          Want to look around first? Run <code>npx pitcrew-cli --demo</code>.
        </p>
      </Message>
    )
  }

  const names = new Map(data.projects.map((p) => [p.id, p.name]))
  const { counts } = data
  return (
    <div className="page home">
      <header className="head">
        <h1>Pit wall</h1>
        <p>Every Claude Code session on this machine, by project. Live ones first.</p>
      </header>
      <dl className="counts">
        <Count label="Waiting for you" value={counts.waiting} status="waiting" mark="w" />
        <Count label="Working" value={counts.working} status="working" />
        <Count label="Your turn" value={counts.yourTurn} status="your-turn" />
        <Count label="Projects this week" value={counts.activeProjects} />
      </dl>

      <div className="wall">
        <div>
          <h2 className="section">Live now</h2>
          {data.live.length ? (
            <ul className="rows">
              {data.live.map((s) => (
                <LiveRow key={s.id} s={s} project={names.get(s.projectId) ?? ''} now={now} />
              ))}
            </ul>
          ) : (
            <p className="empty">No agent is working right now. Sessions show up here the moment they start.</p>
          )}

          <h2 className="section">Projects</h2>
          <ul className="rows">
            {data.projects.map((p) => (
              <ProjectRow key={p.id} p={p} now={now} />
            ))}
          </ul>
        </div>

        <section>
          <h2 className="section">Activity, all projects</h2>
          <Feed items={data.recent} now={now} />
        </section>
      </div>
    </div>
  )
}

function Count({ label, value, status, mark }: { label: string; value: number; status?: SessionStatus; mark?: string }) {
  return (
    <div className={!value ? 'z' : mark}>
      <dt>
        {status ? <Glyph status={status} /> : null}
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  )
}

function LiveRow({ s, project, now }: { s: SessionSummary; project: string; now: number }) {
  return (
    <li>
      <a className="lr" href={`#/s/${s.id}`}>
        <span className="lr-st">
          <Status status={s.status} />
          <span className="lr-w">{ago(s.lastAt, now)}</span>
        </span>
        <span className="lr-m">
          <span className="nm">{s.title}</span>
          <span className="sub">
            {project} · {s.now}
          </span>
        </span>
        <span className="lr-p">{s.plan?.length ? <PlanProgress items={s.plan} /> : null}</span>
        <span className="lr-c">
          <Changes added={s.linesAdded} removed={s.linesRemoved} />
        </span>
      </a>
    </li>
  )
}

function ProjectRow({ p, now }: { p: Project; now: number }) {
  const dirty = p.uncommitted === undefined ? undefined : p.uncommitted ? plural(p.uncommitted, 'uncommitted file') : 'nothing uncommitted'
  return (
    <li>
      <a className="pr" href={`#/p/${encodeURIComponent(p.id)}`}>
        <span className="pr-n">
          <span className="nm">{p.name}</span>
          <code>{tilde(p.path)}</code>
        </span>
        <span className="pr-b">
          {p.branch ? <code>{p.branch}</code> : null}
          {dirty ? <span>{dirty}</span> : null}
        </span>
        <Activity days={p.activity} now={now} />
        <span className="pr-s">
          {p.waiting ? <Status status="waiting" /> : p.working ? <Status status="working" /> : <span>{plural(p.sessions, 'session')}</span>}
          <span className="muted">{ago(p.lastAt, now)}</span>
        </span>
      </a>
    </li>
  )
}

const FEED_WORD: Partial<Record<ActivityItem['kind'], string>> = { you: 'You', agent: 'Agent', note: '' }

function Feed({ items, now }: { items: ActivityItem[]; now: number }) {
  if (!items.length) return <p className="empty">Nothing yet.</p>
  return (
    <ol className="feed">
      {items.map((a, i) => (
        <li key={`${a.sessionId}:${a.at}:${i}`}>
          <a href={`#/s/${a.sessionId}`}>
            <span className="fm">
              {a.project} · {ago(a.at, now)}
            </span>
            <span className="ft">
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
