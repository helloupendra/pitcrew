import { useRef, useState, type KeyboardEvent } from 'react'
import type { Ask, TalkInfo } from '../../../src/core/types'
import { post } from '../api'
import { Diff } from './StepRow'
import { Glyph } from './ui'

/** A question from the agent: it wants to do something and waits for your answer. */
export function AskCard({ ask, onDone }: { ask: Ask; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const answer = async (allow: boolean) => {
    setBusy(true)
    try {
      await post(`/api/talk/asks/${ask.id}`, { allow })
    } finally {
      setBusy(false)
      onDone()
    }
  }
  return (
    <div className="ask" role="alert" data-ask={ask.id}>
      <div className="ask-b">
        <p className="ask-h">
          <Glyph status="waiting" />
          Wants your OK
        </p>
        <p className="ask-t">{ask.title}</p>
        {ask.command && <pre className="code">$ {ask.command}</pre>}
        {ask.diff && ask.diff.length > 0 && <Diff lines={ask.diff} />}
      </div>
      <div className="ask-a">
        <button type="button" className="btn" data-answer="deny" disabled={busy} onClick={() => answer(false)}>
          Deny <kbd>d</kbd>
        </button>
        <button type="button" className="btn btn-go" data-answer="allow" disabled={busy} onClick={() => answer(true)}>
          Allow <kbd>a</kbd>
        </button>
      </div>
    </div>
  )
}

interface ComposerProps {
  placeholder: string
  disabled?: boolean
  note?: string
  sendLabel?: string
  busyLabel?: string
  onSend: (text: string) => Promise<void>
  extra?: React.ReactNode
}

/** A message box: Enter sends, Shift+Enter makes a new line. */
export function Composer({ placeholder, disabled, note, sendLabel = 'Send', busyLabel = 'Sending…', onSend, extra }: ComposerProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const box = useRef<HTMLTextAreaElement>(null)

  const send = async () => {
    const t = text.trim()
    if (!t || sending || disabled) return
    setSending(true)
    setError(undefined)
    try {
      await onSend(t)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
      box.current?.focus()
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className={`composer${disabled ? ' is-disabled' : ''}`}>
      <textarea
        ref={box}
        rows={Math.min(8, Math.max(2, text.split('\n').length))}
        value={text}
        placeholder={placeholder}
        disabled={disabled || sending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        aria-label={placeholder}
      />
      <div className="composer-bar">
        <span className="note">{error ? <span className="minus">{error}</span> : note ?? 'Enter to send · Shift+Enter for a new line'}</span>
        <span className="composer-actions">
          {extra}
          <button type="button" className="btn btn-primary" disabled={disabled || sending || !text.trim()} onClick={() => void send()}>
            {sending ? busyLabel : sendLabel}
          </button>
        </span>
      </div>
    </div>
  )
}

/** The message box under a session's timeline, with Stop when Pitcrew is running it. */
export function SessionTalk({ id, talk, onSent }: { id: string; talk?: TalkInfo; onSent: () => void }) {
  const [stopping, setStopping] = useState(false)
  if (!talk?.enabled) return <p className="talk-off">{talk?.why ?? 'Talk is off.'}</p>

  const running = talk.here && (talk.state === 'working' || talk.state === 'starting')
  const stop = async () => {
    setStopping(true)
    try {
      await post(`/api/sessions/${id}/stop`, {})
    } finally {
      setStopping(false)
      onSent()
    }
  }
  // Held by another window: this page cannot reach that window, but it can continue in a copy.
  if (!talk.canReply && talk.canCopy) {
    return (
      <Composer
        placeholder="Message a copy of this session…"
        note={talk.why}
        sendLabel="Send in a copy"
        busyLabel="Starting the copy…"
        onSend={async (text) => {
          const r = await post<{ sessionId: string; error?: string }>(`/api/sessions/${id}/copy`, { text })
          if (r.error) throw new Error(r.error)
          location.hash = `#/s/${r.sessionId}`
        }}
      />
    )
  }

  const note = !talk.canReply
    ? talk.why
    : talk.error
      ? `Claude Code said: ${talk.error}`
      : talk.here
        ? undefined
        : 'Not open anywhere else: sending continues this session here, with your own Claude Code.'

  return (
    <Composer
      placeholder="Message the agent…"
      disabled={!talk.canReply}
      note={note}
      onSend={async (text) => {
        await post(`/api/sessions/${id}/messages`, { text })
        onSent()
      }}
      extra={
        running ? (
          <button type="button" className="btn" disabled={stopping} onClick={() => void stop()}>
            {stopping ? 'Stopping…' : 'Stop'}
          </button>
        ) : null
      }
    />
  )
}
