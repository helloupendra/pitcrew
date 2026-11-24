import type { DiffLine, Step } from '../../../src/core/types'
import { clockParts } from '../format'
import { Changes, Plan } from './ui'

interface Props {
  step: Step
  open: boolean
  onToggle: () => void
}

/** Messages are shown in full; everything else is one line that opens to show the detail. */
export function StepRow({ step, open, onToggle }: Props) {
  if (step.kind === 'you' || step.kind === 'agent') {
    return (
      <li className={`step msg msg-${step.kind}`} id={`step-${step.n}`}>
        <When at={step.at} />
        <div className="body">
          <span className="who">{step.kind === 'you' ? 'You' : 'Agent'}</span>
          <p className="text">{step.text ?? step.title}</p>
        </div>
      </li>
    )
  }

  const detail = hasDetail(step)
  const state = step.pending ? 'running' : step.failed ? 'failed' : undefined
  const head = (
    <>
      <span className="title">{step.title}</span>
      <Changes added={step.added} removed={step.removed} />
      {state && <span className={`flag flag-${state}`}>{state === 'running' ? 'running…' : 'failed'}</span>}
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
        {open && detail && <Detail step={step} />}
      </div>
    </li>
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
