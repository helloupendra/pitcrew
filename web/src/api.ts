import { useEffect, useRef } from 'react'

const TOKEN_KEY = 'pitcrew.token'
let token = ''

/** The link from the terminal carries the key as #t=…; it is kept for this browser and removed from the address bar. */
export function readToken(): void {
  const match = /^#t=([A-Za-z0-9_-]+)/.exec(location.hash)
  if (match) {
    token = match[1]!
    try {
      localStorage.setItem(TOKEN_KEY, token)
    } catch {
      // private window: the key lives for this page only
    }
    history.replaceState(null, '', `${location.pathname}#/`)
    return
  }
  try {
    token = localStorage.getItem(TOKEN_KEY) ?? ''
  } catch {
    token = ''
  }
}

export class AuthError extends Error {}

/** An answer the server gave with a reason, e.g. 409 "busy in another window". */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  if (res.status === 401) throw new AuthError('Open the link printed in your terminal.')
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, body.error ?? `The server answered ${res.status}.`)
  }
  return (await res.json()) as T
}

/** A URL the browser loads by itself (an <img>), so the key rides along as ?t=. */
export function withKey(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`
}

export function get<T>(path: string): Promise<T> {
  return request<T>(path)
}

/** Changes something. The token goes in the header and the body is JSON, as the server requires. */
export function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

type Listener = (sessions: string[]) => void
const listeners = new Set<Listener>()

/** One stream for the whole page: the server says which sessions changed. */
export function connect(onState: (connected: boolean) => void): () => void {
  const events = new EventSource(`/api/events?t=${encodeURIComponent(token)}`)
  events.addEventListener('change', (e) => {
    const { sessions } = JSON.parse((e as MessageEvent<string>).data) as { sessions: string[] }
    for (const l of listeners) l(sessions)
  })
  events.onopen = () => onState(true)
  events.onerror = () => onState(false)
  return () => events.close()
}

/** Calls `fn` with the changed session ids whenever the server reports a change. */
export function useChanges(fn: Listener): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const l: Listener = (ids) => ref.current(ids)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
}

/**
 * Runs `load` again when asked, but never two at once: a request while one is
 * running is folded into a single follow-up.
 */
export function serialLoader(load: () => Promise<void>): () => void {
  let running = false
  let again = false
  const run = async () => {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await load()
    } finally {
      running = false
      if (again) {
        again = false
        void run()
      }
    }
  }
  return () => void run()
}
