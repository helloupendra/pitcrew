import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Project, SessionSummary } from '../../../src/core/types'
import { get, post, serialLoader, useChanges } from '../api'
import { ago, plural, tilde } from '../format'
import { Composer } from '../parts/talk'
import { runAgent } from './CrewPage'
import { Activity, Changes, Status, useNow } from '../parts/ui'

const REFRESH_MS = 10_000
/** One click runs a crew member on this project with its usual task. */
const QUICK: [string, string][] = [
  ['qa-tester', 'QA'],
  ['code-reviewer', 'Review'],
  ['security-auditor', 'Security'],
  ['test-writer', 'Tests'],
]

export function ProjectPage({ id, onError }: { id: string; onError: (e: unknown) => void }) {
  const [data, setData] = useState<{ project: Project; sessions: SessionSummary[]; talk?: boolean }>()
  const [composing, setComposing] = useState(false)
  const [starting, setStarting] = useState<string>()
  const [quickError, setQuickError] = useState<string>()
  const quick = async (agent: string) => {
    setStarting(agent)
    setQuickError(undefined)
    try {
      await runAgent(agent, id)
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : String(e))
      setStarting(undefined)
    }
  }
  const now = useNow()

  const load = useMemo(
    () => serialLoader(() => get<{ project: Project; sessions: SessionSummary[]; talk?: boolean }>(`/api/projects/${encodeURIComponent(id)}`).then(setData, onError)),
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
        <p className="muted small">
          <span className="mono">{tilde(project.path)}</span>
          {project.branch ? ` · ${project.branch}` : ''}
          {project.uncommitted === undefined ? '' : ` · ${project.uncommitted ? plural(project.uncommitted, 'uncommitted file') : 'nothing uncommitted'}`}
        </p>
        <p className="head-activity muted small">
          <Activity days={project.activity} now={now} /> {plural(sessions.length, 'session')}
        </p>
        {data.talk && !composing && (
          <div className="project-actions">
            <button type="button" className="btn btn-primary" onClick={() => setComposing(true)}>
              New session
            </button>
            <span className="muted small">Run the crew:</span>
            {QUICK.map(([agent, label]) => (
              <button key={agent} type="button" className="btn" disabled={starting !== undefined} onClick={() => void quick(agent)}>
                {starting === agent ? 'Starting…' : label}
              </button>
            ))}
          </div>
        )}
        {quickError && <p className="minus small">{quickError}</p>}
      </header>

      {composing && (
        <section className="new-box">
          <Composer
            placeholder={`What should the agent do in ${project.name}?`}
            note="Starts your own Claude Code in this folder. Anything it wants to change waits for your Allow."
            busyLabel="Starting…"
            onSend={async (text) => {
              const r = await post<{ sessionId: string; error?: string }>('/api/talk/new', { projectId: project.id, text })
              if (r.error) throw new Error(r.error)
              location.hash = `#/s/${r.sessionId}`
            }}
            extra={
              <button type="button" className="btn" onClick={() => setComposing(false)}>
                Cancel
              </button>
            }
          />
        </section>
      )}

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
