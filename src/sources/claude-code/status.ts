import type { SessionStatus, Step } from '../../core/types.js'
import type { LastEvent } from './parse.js'

/** No write for this long and the session counts as idle, whatever it was doing. */
export const IDLE_AFTER_MS = 30 * 60_000
/** A tool call with no answer for this long is probably waiting for you in the terminal. */
export const WAITING_AFTER_MS = 45_000
/** The agent's turn with no write for this long: it most likely stopped. */
const STALLED_AFTER_MS = 10 * 60_000

export interface Status {
  status: SessionStatus
  now: string
}

/**
 * Guesses what a session is doing from its last event and how long ago its file changed.
 * The file does not say when a permission prompt is open, so a long silence after a
 * tool call is reported as "waiting", with the tool named, rather than as a fact.
 */
export function statusOf(last: LastEvent | undefined, pending: Step[], lastAgentText: string | undefined, ageMs: number): Status {
  const latest = pending[pending.length - 1]

  if (ageMs > IDLE_AFTER_MS) return { status: 'idle', now: lastAgentText ? `Last said: ${lastAgentText}` : 'Nothing happening' }

  if (latest) {
    if (latest.kind === 'ask') return { status: 'waiting', now: latest.title }
    if (ageMs > WAITING_AFTER_MS) return { status: 'waiting', now: `Waiting on: ${latest.title} (a long task, or your OK in the terminal)` }
    return { status: 'working', now: doing(latest) }
  }

  switch (last?.kind) {
    case 'agent-text':
      if (last.final) return { status: 'your-turn', now: lastAgentText ? `Finished: ${lastAgentText}` : 'Finished, your turn' }
      break
    case 'stopped':
      return { status: 'your-turn', now: last.why === 'you' ? 'You stopped it' : 'Stopped: the model request failed' }
    case undefined:
      return { status: 'idle', now: 'Nothing yet' }
    default:
      break
  }
  if (ageMs > STALLED_AFTER_MS) return { status: 'idle', now: 'Stopped without finishing' }
  return { status: 'working', now: 'Thinking' }
}

/** "Edited src/app.ts" becomes "Editing src/app.ts": what it is doing now, not what it did. */
function doing(step: Step): string {
  const t = step.title
  const swaps: [RegExp, string][] = [
    [/^Read /, 'Reading '],
    [/^Edited /, 'Editing '],
    [/^Wrote /, 'Writing '],
    [/^Searched for /, 'Searching for '],
    [/^Looked for files /, 'Looking for files '],
    [/^Opened /, 'Opening '],
    [/^Searched the web for /, 'Searching the web for '],
    [/^Used /, 'Using '],
    [/^Listed /, 'Listing '],
  ]
  for (const [from, to] of swaps) if (from.test(t)) return t.replace(from, to)
  if (step.kind === 'plan') return 'Updating the plan'
  if (step.kind === 'run') return `Running: ${t}`
  if (step.kind === 'helper') return `Helper at work: ${t}`
  return t
}
