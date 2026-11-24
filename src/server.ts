import { timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { ClaudeCodeSource } from './sources/claude-code/source.js'

export interface ServerOptions {
  source: ClaudeCodeSource
  port: number
  token: string
  webDir: string
  demo: boolean
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

/**
 * The pit wall's server. It listens on 127.0.0.1 only, answers the API only
 * with the token printed in the terminal, and refuses any Host header that is
 * not this machine (so a web page cannot reach it through DNS rebinding).
 */
export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const { source } = opts
  const clients = new Set<http.ServerResponse>()
  let port = opts.port

  await source.scan()

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong reading the sessions.' })
      else res.end()
      process.stderr.write(`pitcrew: ${err instanceof Error ? err.message : String(err)}\n`)
    })
  })

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!hostAllowed(req.headers.host, port)) return send(res, 403, { error: 'Pitcrew only answers on this machine.' })
    if (req.method !== 'GET') return send(res, 405, { error: 'Read only.' })
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res)
    if (!tokenOk(req, url, opts.token)) return send(res, 401, { error: 'Open the link printed in your terminal.' })

    const parts = url.pathname.split('/').filter(Boolean).slice(1) // drop "api"
    if (parts[0] === 'overview' && parts.length === 1) {
      const o = await source.overview()
      return send(res, 200, { ...o, root: source.root, demo: opts.demo })
    }
    if (parts[0] === 'projects' && parts.length === 2) {
      const p = await source.project(decodeURIComponent(parts[1]!))
      return p ? send(res, 200, p) : send(res, 404, { error: 'No such project.' })
    }
    if (parts[0] === 'sessions' && parts.length === 2) {
      const after = intParam(url, 'after')
      const s = await source.session(parts[1]!, after)
      return s ? send(res, 200, s) : send(res, 404, { error: 'No such session.' })
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

export function tokenOk(req: http.IncomingMessage, url: URL, token: string): boolean {
  const header = req.headers.authorization
  const given = header?.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('t')
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
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
