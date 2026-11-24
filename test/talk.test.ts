import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Overview, SessionDetail } from '../src/core/types.js'
import { folderFor, SessionWriter } from '../src/demo/demo.js'
import { startServer, type RunningServer } from '../src/server.js'
import { ClaudeCodeSource } from '../src/sources/claude-code/source.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const token = 'page-token-for-tests'

describe('talk', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pitcrew-talk-root-'))
  const project = realpathSync(mkdtempSync(path.join(tmpdir(), 'pitcrew-talk-project-')))
  const web = mkdtempSync(path.join(tmpdir(), 'pitcrew-talk-web-'))
  let server: RunningServer
  let readOnly: RunningServer
  let busyId = ''
  let projectId = ''

  beforeAll(async () => {
    // The bridge is TypeScript; the stand-in claude runs it with plain node.
    const bridge = path.join(web, 'bridge.mjs')
    writeFileSync(bridge, transformSync(readFileSync(path.join(here, '../src/talk/bridge.ts'), 'utf8'), { loader: 'ts', format: 'esm' }).code)
    const fake = path.join(here, 'fixtures/fake-claude.mjs')
    chmodSync(fake, 0o755)
    process.env.FAKE_ROOT = root

    // One finished session gives the project; one that is still busy (a recent, unanswered tool call) is "elsewhere".
    const w = new SessionWriter({ cwd: project, branch: 'main', title: 'Earlier work', events: [{ you: 'hi' }, { say: 'Hello.', final: true }] })
    const busy = new SessionWriter({ cwd: project, branch: 'main', title: 'Busy', events: [] })
    busyId = busy.id
    projectId = folderFor(project)
    const dir = path.join(root, projectId)
    mkdirSync(dir, { recursive: true })
    const old = new Date(Date.now() - 5 * 60_000)
    const lines = (wr: SessionWriter, events: Parameters<SessionWriter['lines']>[0][], at: () => Date) =>
      events.flatMap((e) => wr.lines(e, at).flat()).map((l) => JSON.stringify(l) + '\n').join('')
    writeFileSync(path.join(dir, `${w.id}.jsonl`), lines(w, [{ you: 'hi' }, { say: 'Hello.', final: true }], () => old))
    writeFileSync(path.join(dir, `${busy.id}.jsonl`), lines(busy, [{ you: 'go' }, { tool: 'Bash', input: { command: 'sleep 9', description: 'Wait' }, pending: true }], () => new Date()))

    server = await startServer({ source: new ClaudeCodeSource(root), port: 0, token, webDir: web, demo: false, talk: { claude: fake, bridge } })
    readOnly = await startServer({ source: new ClaudeCodeSource(root), port: 0, token, webDir: web, demo: false })
  })
  afterAll(async () => {
    await server.close()
    await readOnly.close()
  })

  const post = (s: RunningServer, p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${s.url}${p}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
  const get = async <T>(p: string) => (await (await fetch(`${server.url}${p}`, { headers: { Authorization: `Bearer ${token}` } })).json()) as T
  const until = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 8_000): Promise<T> => {
    const end = Date.now() + ms
    for (;;) {
      const v = await read()
      if (ok(v) || Date.now() > end) return v
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  it('starts a new session in a project and shows it like any other', async () => {
    const res = await post(server, 'api/talk/new', { projectId, text: 'Say ok' })
    expect(res.status).toBe(201)
    const { sessionId, ready } = (await res.json()) as { sessionId: string; ready: boolean }
    expect(ready).toBe(true)
    const d = await until(
      () => get<SessionDetail>(`api/sessions/${sessionId}`),
      (s) => s.steps?.some((x) => x.kind === 'agent'),
    )
    expect(d.steps.map((s) => s.title)).toEqual(['Say ok', 'ok'])
    expect(d.talk).toMatchObject({ enabled: true, here: true, canReply: true })
  })

  it('brings a permission question to the page and waits for Allow', async () => {
    const res = await post(server, 'api/talk/new', { projectId, text: 'please ask first' })
    const { sessionId } = (await res.json()) as { sessionId: string }
    const asked = await until(
      () => get<SessionDetail>(`api/sessions/${sessionId}`),
      (s) => (s.asks?.length ?? 0) > 0,
    )
    expect(asked.asks![0]).toMatchObject({ tool: 'Bash', title: 'Run: Say hi', command: 'echo hi', toolUseId: 'toolu_fake' })
    // the step is not counted as a changed file or a done command while it waits
    expect(asked.steps.find((x) => x.id === 'toolu_fake')?.pending).toBe(true)
    expect(asked.summary.status).toBe('waiting')
    const o = await get<Overview>('api/overview')
    expect(o.live.find((s) => s.id === sessionId)?.now).toBe('Wants your OK: Run: Say hi')

    expect((await post(server, `api/talk/asks/${asked.asks![0]!.id}`, { allow: true })).status).toBe(200)
    const done = await until(
      () => get<SessionDetail>(`api/sessions/${sessionId}`),
      (s) => s.steps.some((x) => x.kind === 'run' && !x.pending),
    )
    expect(done.asks).toEqual([])
    const run = done.steps.find((x) => x.kind === 'run')
    expect(run?.output).toBe('allow')
    expect(run?.failed).toBeFalsy()
  })

  it('tells Claude Code no when you press Deny', async () => {
    const res = await post(server, 'api/talk/new', { projectId, text: 'ask again' })
    const { sessionId } = (await res.json()) as { sessionId: string }
    const asked = await until(
      () => get<SessionDetail>(`api/sessions/${sessionId}`),
      (s) => (s.asks?.length ?? 0) > 0,
    )
    await post(server, `api/talk/asks/${asked.asks![0]!.id}`, { allow: false })
    const done = await until(
      () => get<SessionDetail>(`api/sessions/${sessionId}`),
      (s) => s.steps.some((x) => x.kind === 'run' && !x.pending),
    )
    expect(done.steps.find((x) => x.kind === 'run')).toMatchObject({ output: 'deny', failed: true })
  })

  it('will not reply to a session that is busy in another window', async () => {
    const res = await post(server, `api/sessions/${busyId}/messages`, { text: 'hello?' })
    expect(res.status).toBe(409)
    const d = await get<SessionDetail>(`api/sessions/${busyId}`)
    expect(d.talk).toMatchObject({ here: false, canReply: false })
  })

  it('needs the token in the header and a JSON body for anything that changes something', async () => {
    const viaQuery = await fetch(`${server.url}api/talk/new?t=${token}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(viaQuery.status).toBe(401)
    expect((await post(server, 'api/talk/new', { projectId, text: 'x' }, { 'Content-Type': 'text/plain' })).status).toBe(415)
    expect((await post(server, 'api/sessions/not-a-uuid/messages', { text: 'x' })).status).toBe(400)
    expect((await post(server, 'api/talk/new', { projectId, text: '   ' })).status).toBe(400)
  })

  it('keeps the bridge and the page apart', async () => {
    // The page token cannot open a permission question...
    expect((await post(server, 'api/talk/asks', { session: busyId, tool: 'Bash', input: {} })).status).toBe(404)
    // ...and a made-up bridge token cannot either.
    expect((await post(server, 'api/talk/asks', { session: busyId, tool: 'Bash', input: {} }, { Authorization: 'Bearer nope' })).status).toBe(401)
  })

  it('refuses every change when started read-only', async () => {
    expect((await post(readOnly, 'api/talk/new', { projectId, text: 'x' })).status).toBe(403)
    const o = (await (await fetch(`${readOnly.url}api/overview`, { headers: { Authorization: `Bearer ${token}` } })).json()) as Overview
    expect(o.talk).toBe(false)
  })
})
