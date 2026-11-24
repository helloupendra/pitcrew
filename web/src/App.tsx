import { useCallback, useEffect, useState } from 'react'
import { AuthError, connect } from './api'
import { useWaitingAlerts } from './parts/alerts'
import { Palette } from './parts/palette'
import { Message } from './parts/ui'
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
      <header className="bar">
        <a className="brand" href="#/">
          Pitcrew
        </a>
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? 'Live' : 'Reconnecting…'}</span>
        <nav className="nav">
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
        <span className="spacer" />
        <span className="kbd-hint muted small" title="Go anywhere, or run the crew">
          ⌘K
        </span>
        {alerts.state !== 'unsupported' && (
          <button
            type="button"
            className={`theme alerts-${alerts.state}`}
            onClick={alerts.toggle}
            title={alerts.state === 'blocked' ? 'Notifications are blocked for this page in your browser settings' : 'A desktop notification when an agent waits for you'}
          >
            {alerts.state === 'on' ? 'Alerts on' : alerts.state === 'blocked' ? 'Alerts blocked' : 'Alerts off'}
          </button>
        )}
        <button type="button" className="theme" onClick={() => setTheme(NEXT_THEME[theme])} title="Switch theme">
          {theme === 'system' ? 'Auto' : theme === 'light' ? 'Light' : 'Dark'}
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
