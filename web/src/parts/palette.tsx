import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { Overview } from '../../../src/core/types'
import { get } from '../api'
import { STATUS_WORD, tilde } from '../format'
import { runAgent } from '../views/CrewPage'

interface Item {
  key: string
  label: string
  hint?: string
  run: () => void | Promise<void>
}

const QUICK_CREW: [string, string][] = [
  ['qa-tester', 'QA'],
  ['code-reviewer', 'a review'],
  ['security-auditor', 'a security audit'],
  ['test-writer', 'the test writer'],
]

/** ⌘K / Ctrl+K: go anywhere, or start a crew member, from the keyboard. */
export function Palette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [data, setData] = useState<Overview>()
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pitcrew:palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pitcrew:palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    setError(undefined)
    get<Overview>('/api/overview').then(setData, () => undefined)
    requestAnimationFrame(() => input.current?.focus())
  }, [open])

  const items = useMemo<Item[]>(() => {
    const go = (hash: string) => () => {
      location.hash = hash
    }
    const list: Item[] = [
      { key: 'sessions', label: 'Sessions', hint: 'page', run: go('#/') },
      { key: 'wall', label: 'Pit wall', hint: 'page', run: go('#/wall') },
      { key: 'lane', label: 'Pit lane', hint: 'page', run: go('#/lane') },
      { key: 'crew', label: 'Crew', hint: 'page', run: go('#/crew') },
    ]
    for (const s of data?.live ?? []) {
      const project = data?.projects.find((p) => p.id === s.projectId)?.name ?? ''
      list.push({ key: `s:${s.id}`, label: s.title, hint: `${STATUS_WORD[s.status]} · ${project}`, run: go(`#/s/${s.id}`) })
    }
    const talk = data?.talk ?? false
    for (const p of data?.projects ?? []) {
      list.push({ key: `p:${p.id}`, label: p.name, hint: tilde(p.path), run: go(`#/p/${encodeURIComponent(p.id)}`) })
      if (talk) {
        for (const [agent, what] of QUICK_CREW) {
          list.push({ key: `r:${agent}:${p.id}`, label: `Run ${what} on ${p.name}`, hint: 'crew', run: () => runAgent(agent, p.id) })
        }
      }
    }
    return list
  }, [data])

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter((i) => words.every((w) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(w))).slice(0, 12)
  }, [items, query])

  if (!open) return null

  const choose = async (item: Item | undefined) => {
    if (!item) return
    try {
      await item.run()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') setOpen(false)
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') void choose(shown[index])
  }

  return (
    <div className="pal-bg" onMouseDown={() => setOpen(false)}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="Go to or run" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={onKey}
          placeholder="Go to a project or session, or run the crew…"
          aria-label="Search"
        />
        <ul>
          {shown.map((item, i) => (
            <li key={item.key}>
              <button type="button" className={i === index ? 'on' : undefined} onMouseEnter={() => setIndex(i)} onClick={() => void choose(item)}>
                <span>{item.label}</span>
                {item.hint && <span>{item.hint}</span>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="pe">Nothing matches.</li>}
        </ul>
        {error && <p className="pe minus">{error}</p>}
        <p className="pal-f">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> open
          </span>
          <span>
            <kbd>Esc</kbd> close
          </span>
        </p>
      </div>
    </div>
  )
}
