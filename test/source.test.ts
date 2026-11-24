import { appendFileSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { folderFor, SessionWriter } from '../src/demo/demo.js'
import type { DemoEvent, DemoSession } from '../src/demo/script.js'
import { startServer, type RunningServer } from '../src/server.js'
import { ClaudeCodeSource } from '../src/sources/claude-code/source.js'
import type { Overview, SessionDetail } from '../src/core/types.js'

const NOW = Date.parse('2026-03-01T12:00:00Z')

/** Writes a session the way Claude Code would, ending `minutesAgo` before NOW. */
function writeSession(root: string, s: DemoSession, minutesAgo: number): { id: string; file: string } {
  const w = new SessionWriter(s)
  const end = NOW - minutesAgo * 60_000
  let t = end - 60_000
  const lines = [w.title(new Date(t))]
  for (const e of s.events) for (const group of w.lines(e, () => new Date((t += 1_000)))) lines.push(...group)
  const dir = path.join(root, folderFor(s.cwd))
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${w.id}.jsonl`)
  writeFileSync(file, lines.map((l) => JSON.stringify(l) + '\n').join(''))
  utimesSync(file, new Date(end), new Date(end))
  return { id: w.id, file }
}

const shop = '/Users/sam/code/shop'
const bash = (description: string, extra: Partial<Extract<DemoEvent, { tool: string }>> = {}): DemoEvent => ({
  tool: 'Bash',
  input: { command: `echo ${description}`, description },
  result: 'ok',
  ...extra,
})

describe('ClaudeCodeSource', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pitcrew-src-'))
  let working: { id: string; file: string }
  let waiting: { id: string; file: string }
  let done: { id: string; file: string }
  let old: { id: string; file: string }
  let long: { id: string; file: string }
  const source = new ClaudeCodeSource(root, { clock: () => NOW, windowBytes: 4_000 })

  beforeAll(async () => {
    working = writeSession(root, { cwd: shop, branch: 'main', title: 'Working one', events: [{ you: 'go' }, bash('Build', { pending: true })] }, 0)
    waiting = writeSession(root, { cwd: shop, branch: 'main', title: 'Waiting one', events: [{ you: 'go' }, bash('Deploy', { pending: true })] }, 2)
    done = writeSession(root, { cwd: shop, branch: 'feat/x', title: 'Finished one', events: [{ you: 'go' }, { say: 'All done.', final: true }] }, 5)
    old = writeSession(root, { cwd: '/Users/sam/code/blog', branch: 'main', title: 'Old one', events: [{ you: 'go' }, { say: 'Done.', final: true }] }, 600)
    const many: DemoEvent[] = [{ you: 'a long task' }]
    for (let i = 0; i < 40; i++) many.push(bash(`step ${i}`))
    many.push({ say: 'Finished the long task.', final: true })
    long = writeSession(root, { cwd: '/Users/sam/code/blog', branch: 'main', title: 'Long one', events: many }, 700)
    mkdirSync(path.join(root, 'not-a-project-file'), { recursive: true })
    writeFileSync(path.join(root, folderFor(shop), 'notes.txt'), 'ignored')
    expect((await source.scan()).length).toBe(5)
  })

  it('lists projects by their real folder, newest first, with live sessions by urgency', async () => {
    const o = await source.overview()
    expect(o.projects.map((p) => [p.name, p.path, p.sessions])).toEqual([
      ['shop', shop, 3],
      ['blog', '/Users/sam/code/blog', 2],
    ])
    expect(o.live.map((s) => [s.title, s.status])).toEqual([
      ['Waiting one', 'waiting'],
      ['Working one', 'working'],
      ['Finished one', 'your-turn'],
    ])
    expect(o.counts).toEqual({ working: 1, waiting: 1, yourTurn: 1, activeProjects: 2 })
    // the newest steps of every session, newest first
    expect(o.recent[0]).toMatchObject({ project: 'shop', session: 'Working one', kind: 'run', title: 'Build' })
    expect(o.recent.map((r) => r.at)).toEqual([...o.recent.map((r) => r.at)].sort().reverse())
    // one session a day for the shop project's three sessions, all today (NOW); folders that are not git repos have no count
    expect(o.projects[0]!.activity).toEqual([0, 0, 0, 0, 0, 0, 3])
    expect(o.projects[0]!.uncommitted).toBeUndefined()
    expect(o.live[0]!.now).toContain('Waiting on: Deploy')
  })

  it('opens a project with all of its sessions', async () => {
    const p = await source.project(folderFor('/Users/sam/code/blog'))
    expect(p?.sessions.map((s) => [s.title, s.status])).toEqual([
      ['Old one', 'idle'],
      ['Long one', 'idle'],
    ])
    expect(await source.project('nope')).toBeUndefined()
  })

  it('sends only what changed since the step asked for', async () => {
    const first = (await source.session(working.id))!
    expect(first.steps.map((s) => s.kind)).toEqual(['you', 'run'])
    expect(first.summary.status).toBe('working')
    const pendingN = first.steps[1]!.n

    appendFileSync(
      working.file,
      JSON.stringify({
        parentUuid: null,
        isSidechain: false,
        type: 'user',
        cwd: shop,
        sessionId: working.id,
        timestamp: new Date(NOW).toISOString(),
        uuid: 'r-1',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_demo_1', content: 'built' }] },
      }) + '\n',
    )
    await source.scanRecent()
    const next = (await source.session(working.id, pendingN))!
    expect(next.steps).toHaveLength(1)
    expect(next.steps[0]).toMatchObject({ n: pendingN, pending: false, output: 'built' })
  })

  it('opens a long session at its end and loads earlier parts on request', async () => {
    const d = (await source.session(long.id))!
    expect(d.partial).toBe(true)
    expect(d.hasEarlier).toBe(true)
    expect(d.steps.at(-1)?.title).toBe('Finished the long task.')
    expect(d.summary.title).toBe('Long one')

    let first = d.steps[0]!.n
    let seen = d.steps.length
    for (let guard = 0; guard < 50; guard++) {
      const e = (await source.earlier(long.id, first, 10))!
      seen += e.steps.length
      if (e.steps.length) first = e.steps[0]!.n
      if (!e.hasEarlier) break
    }
    // 1 prompt + 40 commands + 1 final message
    expect(seen).toBe(42)
    const all = (await source.session(long.id, first))!
    expect(all.steps.filter((s) => s.kind === 'run').every((s) => !s.pending && s.output === 'ok')).toBe(true)
  })

  it('forgets a session whose file is gone', async () => {
    const { rmSync } = await import('node:fs')
    rmSync(old.file)
    expect(await source.scan()).toEqual([old.id])
    expect(await source.session(old.id)).toBeUndefined()
    void done
    void waiting
  })
})

describe('server', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pitcrew-srv-'))
  const web = mkdtempSync(path.join(tmpdir(), 'pitcrew-web-'))
  writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>Pitcrew</title>')
  let server: RunningServer
  const token = 'secret-token-for-tests'

  beforeAll(async () => {
    writeSession(root, { cwd: shop, branch: 'main', title: 'Hello', events: [{ you: 'hi' }, { say: 'Hello.', final: true }] }, 1)
    server = await startServer({ source: new ClaudeCodeSource(root), port: 0, token, webDir: web, demo: false })
  })
  afterAll(() => server.close())

  const call = (p: string, headers: Record<string, string> = {}) =>
    fetch(`${server.url}${p.replace(/^\//, '')}`, { headers: { Authorization: `Bearer ${token}`, ...headers } })

  it('answers with the token and refuses without it', async () => {
    const ok = await call('/api/overview')
    expect(ok.status).toBe(200)
    const o = (await ok.json()) as Overview
    expect(o.projects[0]?.name).toBe('shop')
    expect(o.demo).toBe(false)
    expect((await fetch(`${server.url}api/overview`)).status).toBe(401)
    expect((await call('/api/overview', { Authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await fetch(`${server.url}api/overview?t=${token}`)).status).toBe(200)
  })

  it('refuses another host name (DNS rebinding)', async () => {
    const { request } = await import('node:http')
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: server.port, path: '/api/overview', headers: { Host: 'evil.example', Authorization: `Bearer ${token}` } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    expect(status).toBe(403)
  })

  it('serves the page without the token, and never files outside it', async () => {
    const page = await fetch(server.url)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect((await fetch(`${server.url}..%2f..%2fetc%2fpasswd`)).status).toBe(404)
  })

  it('is read only', async () => {
    expect((await fetch(`${server.url}api/overview`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status).toBe(405)
  })

  it('gives a session by id', async () => {
    const o = (await (await call('/api/overview')).json()) as Overview
    const p = (await (await call(`/api/projects/${encodeURIComponent(o.projects[0]!.id)}`)).json()) as { sessions: { id: string }[] }
    const id = p.sessions[0]!.id
    const d = (await (await call(`/api/sessions/${id}`)).json()) as SessionDetail
    expect(d.steps.map((s) => s.title)).toEqual(['hi', 'Hello.'])
    expect((await call('/api/sessions/nope')).status).toBe(404)
  })
})
