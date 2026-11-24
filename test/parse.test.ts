import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cleanPrompt, describeTool, Parser, shortPath } from '../src/sources/claude-code/parse.js'

const fixture = readFileSync(new URL('./fixtures/session.jsonl', import.meta.url), 'utf8').split('\n')

function parsed() {
  const p = new Parser()
  p.feedAll(fixture)
  return p
}

describe('Parser on a real-shaped Claude Code session', () => {
  it('turns the session into plain steps, skipping bookkeeping, meta lines and broken lines', () => {
    const p = parsed()
    expect(p.steps.map((s) => [s.kind, s.title])).toEqual([
      ['you', 'Fix the cart total: it ignores the discount.'],
      ['agent', 'Let me look at the cart code.'],
      ['read', 'Read src/cart.ts'],
      ['plan', 'Updated the plan (0 of 2 done)'],
      ['edit', 'Edited src/cart.ts'],
      ['run', 'Run the tests'],
      ['note', 'You stopped the agent'],
      ['you', 'The test passes the discount as 10, not 0.1. Handle percentages.'],
      ['note', 'Background command "npm run build" completed (exit code 0)'],
      ['run', 'Push the branch'],
    ])
    expect(p.steps.map((s) => s.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('pairs each tool call with its result', () => {
    const p = parsed()
    const run = p.steps.find((s) => s.title === 'Run the tests')!
    expect(run.pending).toBe(false)
    expect(run.failed).toBe(true)
    expect(run.command).toBe('npm test')
    expect(run.output).toContain('Expected 90, got 100')

    const push = p.steps.at(-1)!
    expect(push.pending).toBe(true)
    expect(p.pending).toEqual([push])
  })

  it('prefers the patch Claude Code stored over its own diff', () => {
    const edit = parsed().steps.find((s) => s.kind === 'edit')!
    expect(edit.diff?.map((l) => l.t).join('')).toBe('--+++ ')
    expect([edit.added, edit.removed]).toEqual([3, 2])
  })

  it('keeps title, plan, folder, branch, model and totals', () => {
    const { meta } = parsed()
    expect(meta.aiTitle).toBe('Fix discount in cart total')
    expect(meta.firstPrompt).toBe('Fix the cart total: it ignores the discount.')
    expect(meta.cwd).toBe('/Users/sam/code/shop')
    expect(meta.branch).toBe('fix/discount')
    expect(meta.model).toBe('claude-sonnet-5-5')
    expect([meta.linesAdded, meta.linesRemoved]).toEqual([3, 2])
    expect(meta.costUSD).toBe(0.12)
    expect(meta.tokens).toBe(42_000)
    expect(meta.plan).toEqual([
      { text: 'Apply the discount in total()', status: 'in_progress' },
      { text: 'Run the tests', status: 'pending' },
    ])
    expect(meta.startedAt).toBe('2026-01-10T10:00:00.000Z')
    expect(meta.last).toEqual({ kind: 'tool' })
  })

  it('never reads the account line or request logs as steps', () => {
    const text = JSON.stringify(parsed().steps)
    expect(text).not.toContain('accountUuid')
    expect(text).not.toContain('this must never be read')
  })

  it('matches a result to a call read later, when an earlier part of the file is loaded', () => {
    const cut = fixture.findIndex((l) => l.includes('"uuid":"r6"')) // the Bash result
    const later = new Parser()
    later.feedAll(fixture.slice(cut))
    const earlier = new Parser()
    earlier.feedAll(fixture.slice(0, cut))
    expect(earlier.pending.map((s) => s.title)).toEqual(['Run the tests'])

    later.prepend(earlier)
    const run = later.steps.find((s) => s.title === 'Run the tests')!
    expect(run.pending).toBe(false)
    expect(run.failed).toBe(true)
    expect(later.steps.map((s) => s.n)).toEqual([...later.steps.keys()].map((i) => i - 6))
    expect(later.steps.map((s) => s.title)).toEqual(parsed().steps.map((s) => s.title))
  })
})

describe('pictures', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const lines = [
    JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-01-10T10:00:00Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_shot', name: 'Read', input: { file_path: '/p/.pitcrew/qa/home.png' } }], stop_reason: 'tool_use' } }),
    JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-01-10T10:00:01Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_shot', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] }] } }),
    JSON.stringify({ type: 'user', uuid: 'u2', timestamp: '2026-01-10T10:00:02Z', message: { role: 'user', content: [{ type: 'text', text: 'Look at this' }, { type: 'image', source: { type: 'base64', media_type: 'image/svg+xml', data: 'PHN2Zz4=' } }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: png } }] } }),
  ]

  it('keeps the screenshots an opened session read, and the images you sent', () => {
    const p = new Parser(0, true)
    p.feedAll(lines)
    expect(p.steps.map((s) => [s.kind, s.images])).toEqual([
      ['read', 1],
      ['you', 1],
    ])
    expect(p.pictures.get('toolu_shot')).toEqual([{ type: 'image/png', data: png }])
    // an SVG could carry script, so only plain image types are kept
    expect(p.pictures.get('u2')).toEqual([{ type: 'image/jpeg', data: png }])
  })

  it('keeps none while listing sessions, but still counts them', () => {
    const p = new Parser()
    p.feedAll(lines)
    expect(p.steps[0]!.images).toBe(1)
    expect(p.pictures.size).toBe(0)
  })
})

describe('describeTool', () => {
  it('names common tools in plain words', () => {
    const cwd = '/Users/sam/code/shop'
    expect(describeTool('Grep', { pattern: 'TODO', path: `${cwd}/src` }, cwd).title).toBe('Searched for “TODO” in src')
    expect(describeTool('WebSearch', { query: 'vitest mock timers' }).title).toBe('Searched the web for “vitest mock timers”')
    expect(describeTool('WebFetch', { url: 'https://example.com/docs' }).title).toBe('Opened example.com/docs')
    expect(describeTool('Agent', { description: 'Check the links', subagent_type: 'Explore' })).toMatchObject({ kind: 'helper', title: 'Check the links', text: 'Explore' })
    expect(describeTool('AskUserQuestion', { questions: [{ question: 'Which colour?' }] }).title).toBe('Asked you: Which colour?')
    expect(describeTool('mcp__github__create_issue', {}).title).toBe('Used create_issue (github)')
    expect(describeTool('Bash', { command: 'sleep 60', run_in_background: true }).title).toBe('sleep 60 (in the background)')
    expect(describeTool('SomethingNew', {}).title).toBe('Used SomethingNew')
  })

  it('shows a new file as added lines', () => {
    const w = describeTool('Write', { file_path: '/x/a.ts', content: 'one\ntwo' })
    expect(w.diff).toEqual([
      { t: '+', s: 'one' },
      { t: '+', s: 'two' },
    ])
    expect(w.added).toBe(2)
  })
})

describe('cleanPrompt', () => {
  it('keeps what you typed and drops what the editor added', () => {
    expect(cleanPrompt('<ide_selection>lines 1-4</ide_selection>Explain this')).toBe('Explain this')
    expect(cleanPrompt('<pasted_content id="1">a log</pasted_content> what broke?')).toBe('a log what broke?')
    expect(cleanPrompt('<command-name>/review</command-name><command-args>src</command-args>')).toBe('/review src')
    expect(cleanPrompt('<system-reminder>x</system-reminder>')).toBe('')
  })
})

describe('shortPath', () => {
  it('shows paths inside the project relative to it, and the home folder as ~', () => {
    expect(shortPath('/Users/sam/code/shop/src/a.ts', '/Users/sam/code/shop')).toBe('src/a.ts')
    expect(shortPath('/home/sam/notes.md', '/Users/sam/code/shop')).toBe('~/notes.md')
  })
})
