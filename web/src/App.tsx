import { useCallback, useEffect, useState } from 'react'
import { AuthError, connect } from './api'
import { useWaitingAlerts } from './parts/alerts'
import { Palette } from './parts/palette'
import { Mark, Message } from './parts/ui'
import { CrewPage } from './views/CrewPage'
import { LanePage } from './views/LanePage'
import { Home } from './views/Home'
import { ProjectPage } from './views/ProjectPage'
import { SessionPage } from './views/SessionPage'

type Route = { page: 'home' } | { page: 'crew' } | { page: 'lane' } | { page: 'project'; id: string } | { page: 'session'; id: string }

function readRoute(): Route {
  if (location.hash === '#/crew') return { page: 'crew' }
  if (location.hash === '#/lane') return { page: 'lane' }
  const [, kind, id] = /^#\/(p|s)\/(.+)$/.exec(location.hash) ?? []
  if (kind === 'p' && id) return { page: 'project', id: decodeURIComponent(id) }
  if (kind === 's' && id) return { page: 'session', id }
  return { page: 'home' }
}

type Theme = 'system' | 'light' | 'dark'
const THEME_KEY = 'pitcrew.theme'
const NEXT_THEME: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' }

function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

/** The ⌘K palette listens for this, so any button can open it. */
const openPalette = () => window.dispatchEvent(new Event('pitcrew:palette'))

export function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [connected, setConnected] = useState(true)
  const [authFailed, setAuthFailed] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [theme, setTheme] = useState<Theme>(savedTheme)
  const alerts = useWaitingAlerts()

  useEffect(() => {
    const onHash = () => {
      setRoute(readRoute())
      setProblem(undefined)
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => connect(setConnected), [])

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') delete root.dataset.theme
    else root.dataset.theme = theme
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // the choice lasts for this page only
    }
  }, [theme])

  const onError = useCallback((e: unknown) => {
    if (e instanceof AuthError) setAuthFailed(true)
    else setProblem(e instanceof Error ? e.message : String(e))
  }, [])

  let body
  if (authFailed) {
    body = (
      <Message title="Open the link from your terminal">
        <p>
          Pitcrew prints a link with a key in it each time it starts. Only that link opens this page, so nothing else on the
          web can read your sessions.
        </p>
      </Message>
    )
  } else if (route.page === 'project') body = <ProjectPage id={route.id} onError={onError} />
  else if (route.page === 'session') body = <SessionPage id={route.id} onError={onError} />
  else if (route.page === 'crew') body = <CrewPage onError={onError} />
  else if (route.page === 'lane') body = <LanePage onError={onError} />
  else body = <Home onError={onError} />

  return (
    <>
      <header className="top">
        <a className="brand" href="#/" aria-label="Pitcrew">
          <Mark />
          <span>Pitcrew</span>
        </a>
        <span className={`live${connected ? '' : ' off'}`} title={connected ? 'Live: changes show up as they happen' : 'Reconnecting…'}>
          <i aria-hidden="true" />
          <span>{connected ? 'Live' : 'Reconnecting…'}</span>
        </span>
        <nav className="nav" aria-label="Pages">
          <a href="#/" aria-current={route.page === 'home' ? 'page' : undefined}>
            Pit wall
          </a>
          <a href="#/lane" aria-current={route.page === 'lane' ? 'page' : undefined}>
            Pit lane
          </a>
          <a href="#/crew" aria-current={route.page === 'crew' ? 'page' : undefined}>
            Crew
          </a>
        </nav>
        <span className="grow" />
        <button type="button" className="kbtn" onClick={openPalette} aria-label="Go to or run (Command K)">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <circle cx="6" cy="6" r="4.2" />
            <path d="M9.3 9.3 13 13" />
          </svg>
          <span>Go to or run…</span>
          <kbd>⌘K</kbd>
        </button>
        {alerts.state !== 'unsupported' && (
          <button
            type="button"
            className="tbtn"
            aria-pressed={alerts.state === 'on'}
            aria-label={alerts.state === 'on' ? 'Alerts on' : alerts.state === 'blocked' ? 'Alerts blocked' : 'Alerts off'}
            onClick={alerts.toggle}
            title={alerts.state === 'blocked' ? 'Notifications are blocked for this page in your browser settings' : 'A desktop notification when an agent waits for you'}
          >
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
              <path d="M3 8.5V5.5a3 3 0 0 1 6 0v3l1 1H2z" />
              <path d="M5 11h2" />
            </svg>
            <span>{alerts.state === 'on' ? 'Alerts on' : alerts.state === 'blocked' ? 'Alerts blocked' : 'Alerts'}</span>
          </button>
        )}
        <button type="button" className="tbtn" onClick={() => setTheme(NEXT_THEME[theme])} title="Theme: auto (your system), light or dark" aria-label={`Theme: ${theme === 'system' ? 'auto' : theme}`}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="M6 1a5 5 0 0 1 0 10z" fill="currentColor" />
          </svg>
          <span>{theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark'}</span>
        </button>
      </header>
      <Palette />
      <main>
        {problem && (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
        {body}
      </main>
    </>
  )
}
