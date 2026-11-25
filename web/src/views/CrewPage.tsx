import { useEffect, useState } from 'react'
import type { Overview } from '../../../src/core/types'
import { get, post } from '../api'
import { tilde } from '../format'

interface CrewAgent {
  id: string
  title: string
  short: string
  task: string
  command: string
  tools: string[]
}
interface OwnAgent {
  id: string
  description: string
}
interface CrewData {
  crew: CrewAgent[]
  own: OwnAgent[]
  talk: boolean
}

const TOOLS = ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch']

/** Starts an agent on a project and opens the new session. */
export async function runAgent(agent: string, projectId: string, task?: string): Promise<void> {
  const r = await post<{ sessionId: string; error?: string }>('/api/crew/run', { agent, projectId, task })
  if (r.error) throw new Error(r.error)
  location.hash = `#/s/${r.sessionId}`
}

export function CrewPage({ onError }: { onError: (e: unknown) => void }) {
  const [data, setData] = useState<CrewData>()
  const [projects, setProjects] = useState<Overview['projects']>([])

  const load = () => {
    get<CrewData>('/api/crew').then(setData, onError)
    get<Overview>('/api/overview').then((o) => setProjects(o.projects), onError)
  }
  useEffect(load, [onError])

  if (!data) return <p className="muted pad">Loading…</p>
  return (
    <div className="page">
      <header className="head">
        <h1>The crew</h1>
        <p>
          Specialist agents for any project. Run one from here, or add them to Claude Code with{' '}
          <code>npx pitcrew-cli crew install</code> and use <code>/qa</code>, <code>/review</code>, <code>/security</code>,{' '}
          <code>/tests</code>, <code>/docs</code> and <code>/deps</code> in your terminal.
        </p>
      </header>

      {!data.talk && <p className="hint">Running an agent from this page needs Talk, which is off in the demo and with --read-only.</p>}
      <ul className="crew">
        {data.crew.map((a) => (
          <AgentCard key={a.id} id={a.id} title={a.title} text={a.short} command={a.command} tools={a.tools} placeholder={a.task} projects={projects} talk={data.talk} />
        ))}
      </ul>

      <section>
        <h2 className="section">Your own agents</h2>
        {data.own.length ? (
          <ul className="crew">
            {data.own.map((a) => (
              <AgentCard key={a.id} id={a.id} title={a.id} text={a.description} placeholder="What should it do?" projects={projects} talk={data.talk} />
            ))}
          </ul>
        ) : (
          <p className="empty">None yet in ~/.claude/agents. Make one below, or install the crew.</p>
        )}
      </section>

      {data.talk && <MakeAgent onMade={load} />}
    </div>
  )
}

interface CardProps {
  id: string
  title: string
  text: string
  command?: string
  tools?: string[]
  placeholder: string
  projects: Overview['projects']
  talk: boolean
}

function AgentCard({ id, title, text, command, tools, placeholder, projects, talk }: CardProps) {
  const [projectId, setProjectId] = useState('')
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const chosen = projectId || projects[0]?.id || ''

  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await runAgent(id, chosen, task.trim() || undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <li className="ag">
      <span className="ag-h">
        <b>{title}</b>
        {command ? <code>/{command}</code> : null}
      </span>
      <span className="ag-p">{text}</span>
      {tools?.length ? <span className="tools">Tools: {tools.join(', ')}</span> : null}
      {talk && projects.length > 0 && (
          <div className="ag-run">
            <select value={chosen} onChange={(e) => setProjectId(e.target.value)} aria-label={`Project for ${title}`}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({tilde(p.path)})
                </option>
              ))}
            </select>
            <input value={task} onChange={(e) => setTask(e.target.value)} placeholder={placeholder} aria-label={`Task for ${title}`} />
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !chosen} onClick={() => void run()}>
              {busy ? 'Starting…' : 'Run'}
            </button>
          </div>
        )}
      {error && <span className="minus small">{error}</span>}
    </li>
  )
}

function MakeAgent({ onMade }: { onMade: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [tools, setTools] = useState<string[]>(['Read', 'Grep', 'Glob'])
  const [state, setState] = useState<{ ok?: string; error?: string; busy?: boolean }>({})

  const save = async () => {
    setState({ busy: true })
    try {
      const r = await post<{ file: string }>('/api/crew/agents', { name, description, prompt, tools })
      setState({ ok: `Saved to ${tilde(r.file)}. Claude Code can use it everywhere now.` })
      setName('')
      setDescription('')
      setPrompt('')
      onMade()
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <section>
      <h2 className="section">Make your own</h2>
      <div className="mk">
        <label>
          <span className="small">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="perf-checker" />
        </label>
        <label>
          <span className="small">What it is for (Claude Code reads this to know when to use it)</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Finds slow pages and heavy queries, with numbers." />
        </label>
        <label className="wide">
          <span className="small">How it works (its instructions)</span>
          <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={'You are the performance checker on this project.\n1. …\nReport: …'} />
        </label>
        <fieldset className="wide">
          <legend>Tools it may use</legend>
          <div className="chk">
          {TOOLS.map((t) => (
            <label key={t}>
              <input type="checkbox" checked={tools.includes(t)} onChange={(e) => setTools(e.target.checked ? [...tools, t] : tools.filter((x) => x !== t))} />
              {t}
            </label>
          ))}
          </div>
        </fieldset>
        <div className="mk-bar wide">
          <span className="small">{state.ok ? <span className="plus">{state.ok}</span> : state.error ? <span className="minus">{state.error}</span> : <span className="muted">Saved as ~/.claude/agents/&lt;name&gt;.md. Never overwrites.</span>}</span>
          <button type="button" className="btn btn-primary" disabled={state.busy || !name.trim()} onClick={() => void save()}>
            Save agent
          </button>
        </div>
      </div>
    </section>
  )
}
