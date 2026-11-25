import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionDetail, SessionSummary, Step, TalkInfo } from '../../../src/core/types'
import { ApiError, get, serialLoader, useChanges } from '../api'
import { ago, clock, dayLabel, plural, tilde } from '../format'
import { isMessage, MessageStep, StepRow } from '../parts/StepRow'
import { AskCard, SessionTalk } from '../parts/talk'
import { Changes, Plan, PlanProgress, Status, useNow } from '../parts/ui'

const REFRESH_MS = 10_000
/** Within this distance of the bottom, new steps keep the page scrolled to the latest. */
const FOLLOW_PX = 160
/** A session started from the page may need a few seconds before its file exists. */
const STARTING_TRIES = 30

/**
 * One session in the Paddock panes: its title in the centre's head, the conversation in the centre,
 * the permission card and the message box under it, and the context (right now, plan, files, cost,
 * commands, where it lives) on the right. Renders four grid children of `.work`, so the panes line up
 * with the session list.
 */
export function SessionPane({ id, onError }: { id: string; onError: (e: unknown) => void }) {
  const [detail, setDetail] = useState<SessionDetail>()
  const [steps, setSteps] = useState<Step[]>([])
  const [hasEarlier, setHasEarlier] = useState(false)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [ctxOpen, setCtxOpen] = useState(false)
  const stepsRef = useRef<Step[]>([])
  const tl = useRef<HTMLElement>(null)
  const follow = useRef(true)
  const scrollToEnd = useRef(true)
  const missing = useRef(0)
  const [starting, setStarting] = useState(false)
  const now = useNow()

  stepsRef.current = steps
  /** The timeline scrolls in its own pane on wide screens, and with the page on a phone. */
  const scroller = (): HTMLElement => {
    const el = tl.current
    return el && getComputedStyle(el).overflowY === 'auto' ? el : document.documentElement
  }
  const nearBottom = () => {
    const el = scroller()
    const top = el === document.documentElement ? window.scrollY : el.scrollTop
    const height = el === document.documentElement ? window.innerHeight : el.clientHeight
    return el.scrollHeight - (top + height) < FOLLOW_PX
  }
  const toEnd = () => {
    const el = scroller()
    if (el === document.documentElement) window.scrollTo({ top: el.scrollHeight })
    else el.scrollTop = el.scrollHeight
  }

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
            // The conversation opens at its latest step, like any chat.
            scrollToEnd.current = true
            follow.current = true
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toEnd()
      scrollToEnd.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps])

  const loadEarlier = async () => {
    const first = steps[0]
    if (!first) return
    setLoadingEarlier(true)
    const el = scroller()
    const before = el.scrollHeight
    try {
      const r = await get<{ steps: Step[]; hasEarlier: boolean }>(`/api/sessions/${id}/earlier?before=${first.n}`)
      follow.current = false
      setSteps((prev) => [...r.steps, ...prev])
      setHasEarlier(r.hasEarlier)
      // Keep the step you were looking at in place.
      requestAnimationFrame(() => {
        if (el === document.documentElement) window.scrollBy({ top: el.scrollHeight - before })
        else el.scrollTop += el.scrollHeight - before
      })
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

  if (!detail) {
    return (
      <header className="sh">
        <div className="col">
          <a className="back" href="#/">
            ← Sessions
          </a>
          <p className="muted">{starting ? 'Starting the session…' : 'Loading…'}</p>
        </div>
      </header>
    )
  }
  const { summary: s, project } = detail
  const asking = new Set((detail.asks ?? []).map((a) => a.toolUseId).filter(Boolean))

  return (
    <>
      <header className="sh">
        <div className="col">
          <a className="back" href="#/">
            ← Sessions
          </a>
          <SessionHead detail={detail} />
        </div>
      </header>

      <aside className={`ctx${ctxOpen ? ' open' : ''}`} aria-label="About this session">
        <div className="col">
          <SessionContext
            detail={detail}
            now={now}
            onFile={showFile}
            projectPath={project.path}
            status={s.status}
            toggle={
              <button type="button" className="ctx-tog" aria-expanded={ctxOpen} onClick={() => setCtxOpen((o) => !o)}>
                {s.plan?.length ? 'Plan, files and cost' : 'Files and cost'}
              </button>
            }
          />
        </div>
      </aside>

      <section className="tl" ref={tl} tabIndex={0} aria-label="What happened">
        <div className="col">
          {hasEarlier && (
            <button type="button" className="earlier" onClick={loadEarlier} disabled={loadingEarlier}>
              {loadingEarlier ? 'Loading…' : 'Show earlier steps'}
            </button>
          )}
          <Timeline sessionId={id} steps={steps} open={open} onToggle={toggle} asking={asking} now={now} />
        </div>
      </section>

      <footer className="foot">
        <div className="col">
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
        </div>
      </footer>
    </>
  )
}

/** Title, then project · branch · model · when it started. */
export function SessionHead({ detail }: { detail: SessionDetail }) {
  const { summary: s, project } = detail
  return (
    <>
      <h1>{s.title}</h1>
      <p>
        <a className="plink" href={`#/p/${encodeURIComponent(project.id)}`} title={tilde(project.path)}>
          {project.name}
        </a>
        {s.branch ? (
          <>
            {' · '}
            <code>{s.branch}</code>
          </>
        ) : null}
        {s.model ? ` · ${s.model}` : ''}
        {s.startedAt ? ` · started ${clock(s.startedAt)}` : ''}
      </p>
    </>
  )
}

/** Messages in full; the tool steps between two messages folded into one run. */
export function Timeline({
  sessionId,
  steps,
  open,
  onToggle,
  asking,
  now,
}: {
  sessionId: string
  steps: Step[]
  open: Set<string>
  onToggle: (id: string) => void
  asking: Set<string | undefined>
  now: number
}) {
  const out: React.ReactNode[] = []
  let run: React.ReactNode[] = []
  const flush = () => {
    if (run.length) out.push(<ol className="run" key={`run-${out.length}`}>{run}</ol>)
    run = []
  }
  steps.forEach((step, i) => {
    const day = step.at ? new Date(step.at).toDateString() : ''
    const prev = steps[i - 1]?.at ? new Date(steps[i - 1]!.at).toDateString() : ''
    if (day && day !== prev && (i > 0 || day !== new Date(now).toDateString())) {
      flush()
      out.push(
        <p className="day" key={`day-${step.id}`}>
          {dayLabel(step.at)}
        </p>,
      )
    }
    if (isMessage(step)) {
      flush()
      out.push(<MessageStep key={step.id} sessionId={sessionId} step={step} />)
    } else {
      run.push(<StepRow key={step.id} sessionId={sessionId} step={step} open={open.has(step.id)} onToggle={() => onToggle(step.id)} asking={asking.has(step.id)} />)
    }
  })
  flush()
  return <div className="tlc">{out}</div>
}

/** Right now, the plan, files, cost, commands and where the session lives. */
export function SessionContext({
  detail,
  now,
  onFile,
  projectPath,
  status,
  toggle,
}: {
  detail: SessionDetail
  now: number
  onFile: (path: string) => void
  projectPath: string
  status: SessionSummary['status']
  /** On narrower screens only "Right now" shows, and this button opens the rest. */
  toggle?: React.ReactNode
}) {
  const { summary: s, files, commands } = detail
  const where = whereItLives(detail.talk, status)
  return (
    <>
      <section className="cs now" aria-live="polite">
        <h2>Right now</h2>
        <div className="now-g">
          <Status status={s.status} />
          <span className="now-w">{ago(s.lastAt, now)}</span>
          {s.plan?.length ? (
            <span className="now-p">
              <PlanProgress items={s.plan} />
            </span>
          ) : null}
          <p className="now-t">{s.now}</p>
          {toggle}
        </div>
      </section>
      <div className="more">
      {s.plan?.length ? (
        <section className="cs">
          <h2>
            Plan
            <span>
              {s.plan.filter((p) => p.status === 'completed').length} of {s.plan.length}
            </span>
          </h2>
          <Plan items={s.plan} />
        </section>
      ) : null}
      <section className="cs">
        <h2>
          {files.length ? 'Files changed' : 'No files changed'}
          {files.length ? <span>{files.length}</span> : null}
        </h2>
        {files.length > 0 && (
          <ul className="fl">
            {files.map((f) => (
              <li key={f.path}>
                <button type="button" onClick={() => onFile(f.path)} title={`${f.path}: show the change`}>
                  <span className="fn">{shortFile(f.path, projectPath)}</span>
                  {f.created && <span className="tag">new</span>}
                  <Changes added={f.added} removed={f.removed} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {s.costUSD !== undefined || s.tokens ? (
        <section className="cs">
          <h2>Cost</h2>
          <p className="fact" title="Claude Code's own estimate at API prices. On a subscription you do not pay this per session.">
            {s.costUSD !== undefined ? usd(s.costUSD) : 'not known'}
            {s.tokens ? <span> · {compact(s.tokens)} tokens</span> : null}
          </p>
        </section>
      ) : null}
      <section className="cs">
        <h2>Commands</h2>
        <p className="fact">
          {plural(commands.total, 'command')}
          {commands.failed ? <span className="minus"> · {commands.failed} failed</span> : null}
        </p>
      </section>
      <section className="cs">
        <h2>Where it lives</h2>
        <p className="fact">{where.place}</p>
        {where.note ? <p className="hint">{where.note}</p> : null}
      </section>
      {detail.partial && <p className="hint">A long session: these count the part loaded so far.</p>}
      </div>
    </>
  )
}

/** Who holds this session: Pitcrew, another window, or nobody. Said up front, so a message goes where you expect. */
export function whereItLives(talk: TalkInfo | undefined, status: SessionSummary['status']): { place: string; note?: string } {
  if (!talk?.enabled) return { place: status === 'idle' ? 'Nobody (idle)' : 'Claude Code, outside Pitcrew', note: talk?.why }
  if (talk.here) return { place: 'Pitcrew (this page)', note: talk.state ? `Its run is ${talk.state}.` : undefined }
  if (!talk.canReply && talk.canCopy) return { place: 'Another window (VS Code or a terminal)', note: talk.why }
  if (talk.canReply) return { place: 'Nobody (idle)', note: 'Sending continues it here, with your own Claude Code.' }
  return { place: 'Claude Code, outside Pitcrew', note: talk.why }
}



function usd(n: number): string {
  if (n > 0 && n < 0.01) return 'under $0.01'
  return '$' + n.toFixed(2)
}

function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'
  if (n >= 1e3) return Math.round(n / 1e3) + 'k'
  return String(n)
}


function shortFile(path: string, root: string): string {
  return path.startsWith(root + '/') ? path.slice(root.length + 1) : tilde(path)
}
