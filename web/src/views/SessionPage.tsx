import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionDetail, Step } from '../../../src/core/types'
import { ApiError, get, serialLoader, useChanges } from '../api'
import { ago, clock, dayLabel, plural, tilde } from '../format'
import { StepRow } from '../parts/StepRow'
import { AskCard, SessionTalk } from '../parts/talk'
import { Changes, Plan, Status, useNow } from '../parts/ui'

const REFRESH_MS = 10_000
/** Within this distance of the bottom, new steps keep the page scrolled to the latest. */
const FOLLOW_PX = 160
/** A session started from the page may need a few seconds before its file exists. */
const STARTING_TRIES = 30

export function SessionPage({ id, onError }: { id: string; onError: (e: unknown) => void }) {
  const [detail, setDetail] = useState<SessionDetail>()
  const [steps, setSteps] = useState<Step[]>([])
  const [hasEarlier, setHasEarlier] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const stepsRef = useRef<Step[]>([])
  const follow = useRef(true)
  const scrollToEnd = useRef(true)
  const missing = useRef(0)
  const [starting, setStarting] = useState(false)
  const now = useNow()

  stepsRef.current = steps

  const load = useMemo(
    () =>
      serialLoader(async () => {
        const have = stepsRef.current
        // Steps that finished never change, so ask only from the oldest one still running.
        const after = have.length ? Math.min(...have.filter((s) => s.pending).map((s) => s.n), have[have.length - 1]!.n + 1) : undefined
        try {
          const d = await get<SessionDetail>(`/api/sessions/${id}${after === undefined ? '' : `?after=${after}`}`)
          follow.current = nearBottom()
          setDetail(d)
          if (after === undefined) {
            setSteps(d.steps)
            setHasEarlier(d.hasEarlier)
            // Wide screens open at the latest step (the side column keeps the status in view);
            // phones open at the top, where the status and the plan are.
            scrollToEnd.current = !narrow()
            follow.current = !narrow()
          } else {
            setSteps((prev) => [...prev.filter((s) => s.n < after), ...d.steps])
          }
          missing.current = 0
          setStarting(false)
        } catch (e) {
          if (e instanceof ApiError && e.status === 404 && missing.current < STARTING_TRIES) {
            missing.current++
            setStarting(true)
            setTimeout(() => load(), 1_000)
            return
          }
          setStarting(false)
          onError(e)
        }
      }),
    [id, onError],
  )

  useEffect(() => {
    setDetail(undefined)
    setSteps([])
    stepsRef.current = []
    setOpen(new Set())
    missing.current = 0
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])
  useChanges(useCallback((ids: string[]) => ids.includes(id) && load(), [id, load]))

  useLayoutEffect(() => {
    if (scrollToEnd.current || follow.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight })
      scrollToEnd.current = false
    }
  }, [steps])

  const loadEarlier = async () => {
    const first = steps[0]
    if (!first) return
    setLoadingEarlier(true)
    const before = document.documentElement.scrollHeight
    try {
      const r = await get<{ steps: Step[]; hasEarlier: boolean }>(`/api/sessions/${id}/earlier?before=${first.n}`)
      follow.current = false
      setSteps((prev) => [...r.steps, ...prev])
      setHasEarlier(r.hasEarlier)
      // Keep the step you were looking at in place.
      requestAnimationFrame(() => window.scrollBy({ top: document.documentElement.scrollHeight - before }))
    } catch (e) {
      onError(e)
    } finally {
      setLoadingEarlier(false)
    }
  }

  const toggle = (stepId: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })

  /** Opens the latest change to a file and scrolls to it. */
  const showFile = (path: string) => {
    const last = [...steps].reverse().find((s) => s.path === path && (s.kind === 'edit' || s.kind === 'write'))
    if (!last) return
    follow.current = false
    setOpen((prev) => new Set(prev).add(last.id))
    requestAnimationFrame(() => document.getElementById(`step-${last.n}`)?.scrollIntoView({ block: 'center' }))
  }

  if (!detail) return <p className="muted pad">{starting ? 'Starting the session…' : 'Loading…'}</p>
  const { summary: s, project, files, commands } = detail
  const asking = new Set((detail.asks ?? []).map((a) => a.toolUseId).filter(Boolean))
  const facts = [s.branch, s.model, s.startedAt ? `started ${clock(s.startedAt)}` : undefined].filter(Boolean).join(' · ')

  return (
    <div className="page session">
      <header className="head">
        <a className="back" href={`#/p/${encodeURIComponent(project.id)}`}>
          ← {project.name}
        </a>
        <h1>{s.title}</h1>
        <p className="muted small">
          <span className="mono">{tilde(project.path)}</span>
          {facts ? ` · ${facts}` : ''}
        </p>
      </header>

      <div className="split">
        <section className="timeline" aria-label="What happened">
          <a className="jump" href="#latest" onClick={jumpToLatest}>
            Jump to the latest step ↓
          </a>
          {hasEarlier && (
            <button type="button" className="earlier" onClick={loadEarlier} disabled={loadingEarlier}>
              {loadingEarlier ? 'Loading…' : 'Show earlier steps'}
            </button>
          )}
          <ol className="steps">
            {steps.map((step, i) => {
              const day = step.at ? new Date(step.at).toDateString() : ''
              const newDay = day && day !== (steps[i - 1]?.at ? new Date(steps[i - 1]!.at).toDateString() : '')
              return (
                <Fragment key={step.id}>
                  {newDay && (i > 0 || day !== new Date(now).toDateString()) ? (
                    <li className="day" aria-hidden="true">
                      {dayLabel(step.at)}
                    </li>
                  ) : null}
                  <StepRow sessionId={id} step={step} open={open.has(step.id)} onToggle={() => toggle(step.id)} asking={asking.has(step.id)} />
                </Fragment>
              )
            })}
          </ol>
          {detail.asks?.map((a) => (
            <AskCard key={a.id} ask={a} onDone={load} />
          ))}
          <SessionTalk
            id={id}
            talk={detail.talk}
            onSent={() => {
              follow.current = true
              load()
            }}
          />
          <span id="latest" />
        </section>

        <aside className="side">
          <section className={`now now-${s.status}`} aria-live="polite">
            <div className="now-line">
              <Status status={s.status} />
              <span className="muted when-ago">{ago(s.lastAt, now)}</span>
            </div>
            <p className="now-text">{s.now}</p>
            {s.plan?.length ? <Plan items={s.plan} /> : null}
          </section>
          <h2 className="section">{files.length ? plural(files.length, 'file') + ' changed' : 'No files changed'}</h2>
          {files.length > 0 && (
            <ul className="files">
              {files.map((f) => (
                <li key={f.path}>
                  <button type="button" onClick={() => showFile(f.path)} title={f.path}>
                    <span className="mono file-name">{shortFile(f.path, project.path)}</span>
                    {f.created && <span className="tag">new</span>}
                    <Changes added={f.added} removed={f.removed} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h2 className="section">Commands</h2>
          <p className="small">
            {plural(commands.total, 'command')}
            {commands.failed ? <span className="minus"> · {commands.failed} failed</span> : null}
          </p>
          {detail.partial && <p className="muted small">A long session: these count the part loaded so far.</p>}
        </aside>
      </div>
    </div>
  )
}

function jumpToLatest(e: React.MouseEvent): void {
  e.preventDefault() // the address bar keeps the session's route
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
}

const narrow = () => window.matchMedia('(max-width: 820px)').matches

function nearBottom(): boolean {
  const el = document.documentElement
  return el.scrollHeight - (window.scrollY + window.innerHeight) < FOLLOW_PX
}

function shortFile(path: string, root: string): string {
  return path.startsWith(root + '/') ? path.slice(root.length + 1) : tilde(path)
}
