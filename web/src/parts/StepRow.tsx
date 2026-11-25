import { useState } from 'react'
import type { DiffLine, Step } from '../../../src/core/types'
import { withKey } from '../api'
import { clockParts } from '../format'
import { Changes, Glyph, Plan } from './ui'

interface Props {
  sessionId: string
  step: Step
  open: boolean
  onToggle: () => void
  /** The agent asked your permission for this step and is waiting. */
  asking?: boolean
}

export const isMessage = (s: Step): boolean => s.kind === 'you' || s.kind === 'agent'

/** A message from you or the agent, shown in full. */
export function MessageStep({ sessionId, step }: { sessionId: string; step: Step }) {
  return (
    <article className={`m m-${step.kind}`} id={`step-${step.n}`}>
      <p className="m-h">
        <b>{step.kind === 'you' ? 'You' : 'Agent'}</b>
        <When at={step.at} />
      </p>
      <p className="m-t">{step.text ?? step.title}</p>
      {step.images ? <Pictures sessionId={sessionId} step={step} /> : null}
    </article>
  )
}

/** A tool step: one line that opens to show the detail. Lives in an <ol className="run">. */
export function StepRow({ sessionId, step, open, onToggle, asking }: Props) {
  const detail = hasDetail(step)
  const state = step.pending ? (asking ? 'asking' : 'running') : step.failed ? 'failed' : undefined
  const FLAG = { running: 'running', asking: 'wants your OK', failed: 'failed' }
  const head = (
    <>
      <span className="car" aria-hidden="true" />
      <span className="st-t">{step.title}</span>
      <Changes added={step.added} removed={step.removed} />
      {state && (
        <span className={`flag flag-${state}`}>
          {state === 'running' ? <Glyph status="working" /> : state === 'asking' ? <Glyph status="waiting" /> : null}
          {FLAG[state]}
        </span>
      )}
      <When at={step.at} />
    </>
  )

  return (
    <li id={`step-${step.n}`} className={step.failed ? 'st-failed' : undefined}>
      {detail ? (
        <button type="button" className="st" aria-expanded={open} onClick={onToggle}>
          {head}
        </button>
      ) : (
        <div className="st">{head}</div>
      )}
      {step.images ? <Pictures sessionId={sessionId} step={step} /> : null}
      {open && detail && <Detail step={step} />}
    </li>
  )
}

/** Screenshots the agent read, or images you sent: small, and large on a click. */
function Pictures({ sessionId, step }: { sessionId: string; step: Step }) {
  const [big, setBig] = useState<number>()
  const src = (k: number) => withKey(`/api/sessions/${sessionId}/images/${encodeURIComponent(step.id)}/${k}`)
  return (
    <div className="pictures">
      {Array.from({ length: step.images ?? 0 }, (_, k) => (
        <button key={k} type="button" className={big === k ? 'picture is-big' : 'picture'} onClick={() => setBig(big === k ? undefined : k)} aria-label={big === k ? 'Make smaller' : 'Make larger'}>
          <img src={src(k)} alt={`Picture ${k + 1} of ${step.title}`} loading="lazy" />
        </button>
      ))}
    </div>
  )
}

/** The time only; the timeline marks each new day with its own line. */
function When({ at }: { at: string }) {
  const { hm } = clockParts(at)
  return <time dateTime={at}>{hm}</time>
}

function hasDetail(s: Step): boolean {
  return Boolean(s.diff?.length || s.command || s.output || s.plan?.length || (s.text && s.kind !== 'you' && s.kind !== 'agent'))
}

function Detail({ step }: { step: Step }) {
  return (
    <div className="dt">
      {step.plan && <Plan items={step.plan} />}
      {step.kind === 'note' || step.kind === 'ask' || step.kind === 'helper' ? step.text && <p className="text">{step.text}</p> : null}
      {step.command && <pre className="code">$ {step.command}</pre>}
      {step.diff && <Diff lines={step.diff} />}
      {step.output && <pre className={`code${step.failed ? ' is-failed' : ''}`}>{step.output}</pre>}
    </div>
  )
}

export function Diff({ lines }: { lines: DiffLine[] }) {
  return (
    <pre className="code diff">
      {lines.map((l, i) =>
        l.t === '~' ? (
          <span key={i} className="d-gap">
            {l.s || '⋯'}
          </span>
        ) : (
          <span key={i} className={l.t === '+' ? 'd-add' : l.t === '-' ? 'd-del' : 'd-ctx'}>
            <span className="d-mark" aria-hidden="true">
              {l.t === '-' ? '−' : l.t === '+' ? '+' : ' '}
            </span>
            {l.s}
          </span>
        ),
      )}
    </pre>
  )
}
