import { useEffect, useRef, useState } from 'react'
import type { Overview } from '../../../src/core/types'
import { get, useChanges } from '../api'

const KEY = 'pitcrew.alerts'
const EVERY_MS = 15_000

export type AlertState = 'on' | 'off' | 'blocked' | 'unsupported'

function saved(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

function initial(): AlertState {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  return saved() && Notification.permission === 'granted' ? 'on' : 'off'
}

/**
 * A desktop notification when an agent starts waiting for you (a permission
 * question, or a long silence after a tool call), while this page is open.
 */
export function useWaitingAlerts(): { state: AlertState; toggle: () => void } {
  const [state, setState] = useState<AlertState>(initial)
  const seen = useRef(new Map<string, string>())
  const busy = useRef(false)

  const check = async () => {
    if (state !== 'on' || busy.current) return
    busy.current = true
    try {
      const o = await get<Overview>('/api/overview')
      const names = new Map(o.projects.map((p) => [p.id, p.name]))
      const first = seen.current.size === 0
      for (const s of o.live) {
        const before = seen.current.get(s.id)
        if (!first && s.status === 'waiting' && before !== 'waiting') {
          const n = new Notification(`${names.get(s.projectId) ?? 'An agent'} is waiting for you`, { body: `${s.title}\n${s.now}`, tag: s.id })
          n.onclick = () => {
            window.focus()
            location.hash = `#/s/${s.id}`
            n.close()
          }
        }
      }
      seen.current = new Map(o.live.map((s) => [s.id, s.status]))
      if (!seen.current.size) seen.current.set('', '') // remember that a first look happened
    } catch {
      // the page shows connection problems itself
    } finally {
      busy.current = false
    }
  }

  useEffect(() => {
    if (state !== 'on') return
    void check()
    const t = setInterval(() => void check(), EVERY_MS)
    return () => clearInterval(t)
  }, [state])
  useChanges(() => void check())

  const toggle = async () => {
    if (state === 'unsupported' || state === 'blocked') return
    if (state === 'on') {
      setState('off')
      try {
        localStorage.setItem(KEY, 'off')
      } catch {
        // fine
      }
      return
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    const next: AlertState = permission === 'granted' ? 'on' : permission === 'denied' ? 'blocked' : 'off'
    setState(next)
    try {
      localStorage.setItem(KEY, next === 'on' ? 'on' : 'off')
    } catch {
      // fine
    }
  }

  return { state, toggle: () => void toggle() }
}
