import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { SessionDetail, SessionSummary, TalkInfo } from './core/types.js'
import type { ClaudeCodeSource } from './sources/claude-code/source.js'
import { findElsewhere, type Elsewhere } from './talk/elsewhere.js'
import { Talk } from './talk/talk.js'

export interface ServerOptions {
  source: ClaudeCodeSource
  port: number
  token: string
  webDir: string
  demo: boolean
  /** Talk settings; leave out for a read-only pit wall. */
  talk?: { claude: string; bridge: string }
  /** How to tell whether a session is open in another Claude Code window (replaceable in tests). */
  elsewhere?: typeof findElsewhere
}

const ELSEWHERE_WHY: Record<Exclude<Elsewhere, undefined> | 'busy', string> = {
  session: 'This session is open in another Claude Code window (VS Code or a terminal). Reply there, or continue in a copy here.',
  folder: 'A Claude Code window is open in this project and may hold this session. Reply there, or continue in a copy here.',
  busy: 'This session is busy in another window. Reply there, or continue in a copy here.',
}

export interface RunningServer {
  url: string
  port: number
  close(): Promise<void>
}

const FAST_POLL_MS = 1_000
const FULL_SCAN_MS = 5_000
const HEARTBEAT_MS = 20_000
const PORT_TRIES = 20
/** How long the bridge's "any answer yet?" request is held open. */
const ASK_WAIT_MS = 25_000
/** How long a new session gets to write its file before the page is sent to it anyway. */
const NEW_SESSION_WAIT_MS = 20_000
const MAX_BODY = 256 * 1024
const MAX_MESSAGE = 100_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * The pit wall's server. It listens on 127.0.0.1 only, answers the API only
 * with the token printed in the terminal, and refuses any Host header that is
 * not this machine (so a web page cannot reach it through DNS rebinding).
 *
 * Anything that changes something (sending a message, Allow/Deny, Stop) also
 * needs the token in the Authorization header, never in the URL, and a JSON
 * body: a plain form on another site can send neither.
 */
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { source } = opts
  const elsewhere = opts.elsewhere ?? findElsewhere
  const clients = new Set<http.ServerResponse>()
  let port = opts.port
  const bridgeToken = randomBytes(24).toString('base64url')

  const talk = opts.talk
    ? new Talk({
        claude: opts.talk.claude,
        bridge: opts.talk.bridge,
        bridgeToken,
        serverUrl: () => `http://127.0.0.1:${port}/`,
        onChange: (id) => broadcast([id]),
      })
    : undefined

  await source.scan()

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message })
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong reading the sessions.' })
      else res.end()
      process.stderr.write(`pitcrew: ${err instanceof Error ? err.message : String(err)}\n`)
    })
  })

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host, port)) return send(res, 403, { error: 'Pitcrew only answers on this machine.' })
    const url = new URL(req.url ?? '/', 'http://localhost')
    const method = req.method ?? 'GET'

    if (!url.pathname.startsWith('/api/')) {
      if (method !== 'GET') return send(res, 405, { error: 'Not here.' })
      return serveStatic(url.pathname, res)
    }
    const parts = url.pathname.split('/').filter(Boolean).slice(1) // drop "api"

    // The permission bridge has its own key and only these two routes.
    if (parts[0] === 'talk' && parts[1] === 'asks' && isBridge(req)) return bridgeRoute(req, res, parts)

    if (!tokenOk(req, url, opts.token, method === 'GET')) return send(res, 401, { error: 'Open the link printed in your terminal.' })
    if (method === 'GET') return getRoute(res, url, parts)
    if (method === 'POST') return postRoute(req, res, parts)
    return send(res, 405, { error: 'Not allowed.' })
  }

  async function getRoute(res: http.ServerResponse, url: URL, parts: string[]): Promise<void> {
    if (parts[0] === 'overview' && parts.length === 1) {
      const o = await source.overview()
      const live = o.live.map(withTalk)
      const count = (st: SessionSummary['status']) => live.filter((s) => s.status === st).length
      return send(res, 200, {
        ...o,
        live,
        counts: { ...o.counts, working: count('working'), waiting: count('waiting'), yourTurn: count('your-turn') },
        root: source.root,
        demo: opts.demo,
        talk: Boolean(talk),
      })
    }
    if (parts[0] === 'projects' && parts.length === 2) {
      const p = await source.project(decodeURIComponent(parts[1]!))
      return p ? send(res, 200, { ...p, sessions: p.sessions.map(withTalk), talk: Boolean(talk) }) : send(res, 404, { error: 'No such project.' })
    }
    if (parts[0] === 'sessions' && parts.length === 2) {
      const id = parts[1]!
      const s = await source.session(id, intParam(url, 'after'))
      if (!s) return send(res, 404, { error: 'No such session.' })
      return send(res, 200, { ...s, summary: withTalk(s.summary), talk: await talkInfo(id, s), asks: talk?.asksFor(id) ?? [] })
    }
    if (parts[0] === 'sessions' && parts[2] === 'earlier' && parts.length === 3) {
      const before = intParam(url, 'before')
      if (before === undefined) return send(res, 400, { error: 'before= is needed.' })
      const s = await source.earlier(parts[1]!, before)
      return s ? send(res, 200, s) : send(res, 404, { error: 'No such session.' })
    }
    if (parts[0] === 'events' && parts.length === 1) return openStream(res)
    return send(res, 404, { error: 'Not found.' })
  }

  async function postRoute(req: http.IncomingMessage, res: http.ServerResponse, parts: string[]): Promise<void> {
    if (!talk) throw new HttpError(403, 'Pitcrew was started read-only (--read-only).')
    const body = await readJson(req)

    // Reply to a session.
    if (parts[0] === 'sessions' && parts[2] === 'messages' && parts.length === 3) {
      const id = sessionId(parts[1])
      const text = message(body)
      const run = talk.run(id)
      if (run && run.state !== 'ended') {
        talk.send(id, '', text, 'resume')
        return send(res, 202, { ok: true })
      }
      const info = await source.sessionInfo(id)
      if (!info) throw new HttpError(404, 'No such session.')
      const held = await heldElsewhere(id, info.status, info.cwd)
      if (held) throw new HttpError(409, ELSEWHERE_WHY[held])
      const cwd = await folder(info.cwd)
      talk.send(id, cwd, text, 'resume')
      return send(res, 202, { ok: true })
    }

    // Continue a session in a copy: a new session with the same history; the original is not touched.
    if (parts[0] === 'sessions' && parts[2] === 'copy' && parts.length === 3) {
      const from = sessionId(parts[1])
      const text = message(body)
      const info = await source.sessionInfo(from)
      if (!info) throw new HttpError(404, 'No such session.')
      const cwd = await folder(info.cwd)
      const id = randomUUID()
      talk.send(id, cwd, text, 'copy', from)
      const ready = await until(async () => {
        await source.scan()
        return source.has(id) || talk.run(id)?.state === 'ended'
      }, NEW_SESSION_WAIT_MS)
      return send(res, 201, { sessionId: id, ready: ready && source.has(id), error: talk.run(id)?.error })
    }

    // Stop a session Pitcrew runs.
    if (parts[0] === 'sessions' && parts[2] === 'stop' && parts.length === 3) {
      return send(res, 200, { stopped: talk.stop(sessionId(parts[1])) })
    }

    // Start a new session in a project.
    if (parts[0] === 'talk' && parts[1] === 'new' && parts.length === 2) {
      const projectId = typeof body.projectId === 'string' ? body.projectId : ''
      const project = (await source.project(projectId))?.project
      if (!project) throw new HttpError(404, 'No such project.')
      const cwd = await folder(project.path)
      const id = randomUUID()
      talk.send(id, cwd, message(body), 'new')
      const started = await until(async () => {
        await source.scan()
        return source.has(id) || talk.run(id)?.state === 'ended'
      }, NEW_SESSION_WAIT_MS)
      return send(res, 201, { sessionId: id, ready: started && source.has(id), error: talk.run(id)?.error })
    }

    // Allow or deny what an agent asked for.
    if (parts[0] === 'talk' && parts[1] === 'asks' && parts.length === 3) {
      if (typeof body.allow !== 'boolean') throw new HttpError(400, 'allow must be true or false.')
      return send(res, 200, { ok: talk.decide(parts[2]!, body.allow) })
    }
    return send(res, 404, { error: 'Not found.' })
  }

  async function bridgeRoute(req: http.IncomingMessage, res: http.ServerResponse, parts: string[]): Promise<void> {
    if (!talk) throw new HttpError(403, 'Talk is off.')
    if (req.method === 'POST' && parts.length === 2) {
      const body = await readJson(req)
      const id = sessionId(body.session)
      const input = typeof body.input === 'object' && body.input !== null ? (body.input as Record<string, unknown>) : {}
      const cwd = (await source.sessionInfo(id))?.cwd
      const toolUseId = typeof body.toolUseId === 'string' ? body.toolUseId : undefined
      return send(res, 201, { id: talk.ask(id, String(body.tool ?? 'tool'), input, cwd, toolUseId) })
    }
    if (req.method === 'GET' && parts.length === 3) {
      const d = await talk.wait(parts[2]!, ASK_WAIT_MS)
      return send(res, 200, d ? { decided: true, ...d } : { decided: false })
    }
    return send(res, 404, { error: 'Not found.' })
  }

  function isBridge(req: http.IncomingMessage): boolean {
    return safeEqual(bearer(req) ?? '', bridgeToken)
  }

  /** The session's status as the page should see it: an open question means it waits for you. */
  function withTalk(s: SessionSummary): SessionSummary {
    if (!talk) return s
    const asks = talk.asksFor(s.id)
    if (asks.length) return { ...s, status: 'waiting', now: `Wants your OK: ${asks[0]!.title}` }
    const run = talk.run(s.id)
    if (run?.state === 'starting' || run?.state === 'working') return { ...s, status: 'working' }
    return s
  }

  /** Why a session Pitcrew does not run cannot be continued in place, or undefined when it can. */
  async function heldElsewhere(id: string, status: SessionSummary['status'], cwd: string | undefined): Promise<keyof typeof ELSEWHERE_WHY | undefined> {
    const where = await elsewhere(id, cwd, talk?.ownPids() ?? new Set())
    if (where) return where
    return status === 'working' || status === 'waiting' ? 'busy' : undefined
  }

  async function talkInfo(id: string, s: SessionDetail): Promise<TalkInfo> {
    if (!talk) return { enabled: false, here: false, canReply: false, canCopy: false, why: 'Pitcrew was started read-only.' }
    const run = talk.run(id)
    const here = Boolean(run && run.state !== 'ended')
    const held = here ? undefined : await heldElsewhere(id, s.summary.status, (await source.sessionInfo(id))?.cwd)
    return {
      enabled: true,
      here,
      state: run?.state,
      error: run?.error,
      canReply: !held,
      canCopy: true,
      why: held ? ELSEWHERE_WHY[held] : undefined,
    }
  }

  function openStream(res: http.ServerResponse): void {
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
    res.write('retry: 2000\n\n')
    clients.add(res)
    res.on('close', () => clients.delete(res))
  }

  function broadcast(sessions: string[]): void {
    if (!sessions.length) return
    const data = `event: change\ndata: ${JSON.stringify({ sessions })}\n\n`
    for (const c of clients) c.write(data)
  }

  async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
    const file = path.resolve(opts.webDir, rel)
    if (!file.startsWith(path.resolve(opts.webDir) + path.sep)) return send(res, 404, { error: 'Not found.' })
    try {
      const body = await readFile(file)
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      if (rel === 'index.html') return send(res, 500, { error: 'The web page is not built. Run: npm run build' })
      send(res, 404, { error: 'Not found.' })
    }
  }

  // Watch the session files: recent ones every second, everything every few seconds.
  let scanning = false
  let lastFull = 0
  const timer = setInterval(async () => {
    if (scanning) return
    scanning = true
    try {
      const full = Date.now() - lastFull >= FULL_SCAN_MS
      if (full) lastFull = Date.now()
      broadcast(full ? await source.scan() : await source.scanRecent())
    } catch {
      // a file vanished mid-scan; the next tick sees the new state
    } finally {
      scanning = false
    }
  }, FAST_POLL_MS)
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': still here\n\n')
  }, HEARTBEAT_MS)

  for (let i = 0; ; i++) {
    try {
      await listen(server, port)
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' || i >= PORT_TRIES) throw err
      port++
    }
  }
  port = (server.address() as AddressInfo).port

  return {
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(timer)
        clearInterval(heartbeat)
        talk?.closeAll()
        for (const c of clients) c.end()
        server.close(() => resolve())
      }),
  }
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

/** GET may carry the token as ?t= (the event stream cannot set headers); anything else needs the header. */
export function tokenOk(req: http.IncomingMessage, url: URL, token: string, allowQuery = true): boolean {
  const given = bearer(req) ?? (allowQuery ? url.searchParams.get('t') : null)
  return given ? safeEqual(given, token) : false
}

function bearer(req: http.IncomingMessage): string | undefined {
  const header = req.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Send JSON.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'Too long.')
    chunks.push(chunk)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'That is not valid JSON.')
  }
}

function sessionId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, 'Not a session id.')
  return value.toLowerCase()
}

function message(body: Record<string, unknown>): string {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) throw new HttpError(400, 'Write a message first.')
  if (text.length > MAX_MESSAGE) throw new HttpError(413, 'That message is too long.')
  return text
}

async function folder(dir: string | undefined): Promise<string> {
  try {
    if (dir && (await stat(dir)).isDirectory()) return dir
  } catch {
    // fall through
  }
  throw new HttpError(409, `The project folder ${dir ?? ''} is not there any more.`)
}

async function until(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

function intParam(url: URL, name: string): number | undefined {
  const v = url.searchParams.get(name)
  if (v === null || !/^-?\d+$/.test(v)) return undefined
  return Number(v)
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
