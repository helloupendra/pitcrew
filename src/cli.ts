#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startDemo, type Demo } from './demo/demo.js'
import { startServer } from './server.js'
import { ClaudeCodeSource, defaultRoot } from './sources/claude-code/source.js'

const HELP = `pitcrew: a local pit wall for your coding agents

Usage
  npx pitcrew            watch your Claude Code sessions
  npx pitcrew --demo     try it with made-up sessions

Options
  --demo          use made-up sessions (nothing of yours is read)
  --port <n>      port to listen on (default 4747; the next free one is used)
  --dir <path>    the sessions folder (default ~/.claude/projects,
                  or $CLAUDE_CONFIG_DIR/projects)
  --no-open       do not open the browser
  -v, --version   print the version
  -h, --help      show this help

Pitcrew listens on 127.0.0.1 only, reads your session files without changing
them, and sends nothing anywhere.`

interface Args {
  demo: boolean
  port: number
  dir?: string
  open: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { demo: false, port: 4747, open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const value = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${a} needs a value`)
      return v
    }
    if (a === '--demo') args.demo = true
    else if (a === '--no-open') args.open = false
    else if (a === '--port') {
      const port = Number(value())
      if (!Number.isInteger(port) || port < 1 || port > 65535) fail('--port must be a number from 1 to 65535')
      args.port = port
    } else if (a === '--dir') args.dir = value()
    else if (a === '-h' || a === '--help') {
      console.log(HELP)
      process.exit(0)
    } else if (a === '-v' || a === '--version') {
      console.log(version())
      process.exit(0)
    } else fail(`unknown option ${a} (see --help)`)
  }
  return args
}

function fail(message: string): never {
  console.error(`pitcrew: ${message}`)
  process.exit(2)
}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return pkg.version
}

function openBrowser(url: string): void {
  const [cmd, ...rest] =
    process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url]
  try {
    spawn(cmd!, rest, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref()
  } catch {
    // no browser to open: the link is printed anyway
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  let demo: Demo | undefined
  if (args.demo) demo = await startDemo()
  const root = demo?.root ?? args.dir ?? defaultRoot()

  const token = randomBytes(24).toString('base64url')
  const server = await startServer({
    source: new ClaudeCodeSource(root),
    port: args.port,
    token,
    webDir: fileURLToPath(new URL('./web/', import.meta.url)),
    demo: Boolean(demo),
  })
  const link = `${server.url}#t=${token}`

  console.log('')
  console.log(`  Pitcrew ${version()}${demo ? '  (demo: made-up sessions)' : ''}`)
  console.log(`  Watching  ${demo ? 'a demo folder' : root}`)
  console.log(`  Open      ${link}`)
  console.log('')
  console.log('  Only this machine can open it. Press Ctrl+C to stop.')
  console.log('')
  if (args.open) openBrowser(link)

  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    await server.close()
    await demo?.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main().catch((err: unknown) => {
  console.error(`pitcrew: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
