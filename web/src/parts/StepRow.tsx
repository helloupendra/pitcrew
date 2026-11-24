import { useState } from 'react'
import type { DiffLine, Step } from '../../../src/core/types'
import { withKey } from '../api'
import { clockParts } from '../format'
import { Changes, Plan } from './ui'

interface Props {
  sessionId: string
  step: Step
  open: boolean
  onToggle: () => void
  /** The agent asked your permission for this step and is waiting. */
  asking?: boolean
}

/** Messages are shown in full; everything else is one line that opens to show the detail. */
export function StepRow({ sessionId, step, open, onToggle, asking }: Props) {
  if (step.kind === 'you' || step.kind === 'agent') {
    return (
      <li className={`step msg msg-${step.kind}`} id={`step-${step.n}`}>
        <When at={step.at} />
        <div className="body">
          <span className="who">{step.kind === 'you' ? 'You' : 'Agent'}</span>
          <p className="text">{step.text ?? step.title}</p>
          {step.images ? <Pictures sessionId={sessionId} step={step} /> : null}
        </div>
      </li>
    )
  }

  const detail = hasDetail(step)
  const state = step.pending ? (asking ? 'asking' : 'running') : step.failed ? 'failed' : undefined
  const FLAG = { running: 'running…', asking: 'waiting for your OK', failed: 'failed' }
  const head = (
    <>
      <span className="title">{step.title}</span>
      <Changes added={step.added} removed={step.removed} />
      {state && <span className={`flag flag-${state}`}>{FLAG[state]}</span>}
    </>
  )

  return (
    <li className={`step tool kind-${step.kind}${step.failed ? ' is-failed' : ''}`} id={`step-${step.n}`}>
      <When at={step.at} />
      <div className="body">
        {detail ? (
          <button type="button" className="line" aria-expanded={open} onClick={onToggle}>
            <span className="caret" aria-hidden="true">
              {open ? '▾' : '▸'}
            </span>
            {head}
          </button>
        ) : (
          <div className="line">
            <span className="caret" aria-hidden="true" />
            {head}
          </div>
        )}
        {step.images ? <Pictures sessionId={sessionId} step={step} /> : null}
        {open && detail && <Detail step={step} />}
      </div>
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
  const { hm, sec } = clockParts(at)
  return (
    <time className="when" dateTime={at}>
      {hm}
      <span className="sec">{sec}</span>
    </time>
  )
}

function hasDetail(s: Step): boolean {
  return Boolean(s.diff?.length || s.command || s.output || s.plan?.length || (s.text && s.kind !== 'you' && s.kind !== 'agent'))
}

function Detail({ step }: { step: Step }) {
  return (
    <div className="detail">
      {step.plan && <Plan items={step.plan} />}
      {step.kind === 'note' || step.kind === 'ask' || step.kind === 'helper' ? step.text && <p className="text">{step.text}</p> : null}
      {step.command && <pre className="code">$ {step.command}</pre>}
      {step.diff && <Diff lines={step.diff} />}
      {step.output && <pre className={`code output${step.failed ? ' is-failed' : ''}`}>{step.output}</pre>}
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
            {'\n'}
          </span>
        ) : (
          <span key={i} className={l.t === '+' ? 'd-add' : l.t === '-' ? 'd-del' : 'd-ctx'}>
            <span className="d-mark" aria-hidden="true">
              {l.t}
            </span>
            {l.s}
            {'\n'}
          </span>
        ),
      )}
    </pre>
  )
}
