#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { accessSync, constants, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { installCrew, loadCrew } from './crew/crew.js'
import { startDemo, type Demo } from './demo/demo.js'
import { startServer } from './server.js'
import { ClaudeCodeSource, defaultRoot } from './sources/claude-code/source.js'

const HELP = `pitcrew: a local pit wall for your coding agents

Usage
  npx pitcrew-cli                      watch your Claude Code sessions
  npx pitcrew-cli --demo               try it with made-up sessions
  npx pitcrew-cli crew install         add the crew to Claude Code (~/.claude):
                                       /qa /review /security /tests /docs /deps
  npx pitcrew-cli crew install --project <dir>   …to one project only
  npx pitcrew-cli crew list            show the crew

  (After npm install -g pitcrew-cli, the command is just: pitcrew)

Options
  --demo          use made-up sessions (nothing of yours is read)
  --port <n>      port to listen on (default 4747; the next free one is used)
  --dir <path>    the sessions folder (default ~/.claude/projects,
                  or $CLAUDE_CONFIG_DIR/projects)
  --read-only     watch only: no messages, Allow/Deny or Stop from the page
  --claude <path> the Claude Code command to run (default: claude on PATH)
  --no-open       do not open the browser
  -v, --version   print the version
  -h, --help      show this help

Pitcrew listens on 127.0.0.1 only and sends nothing anywhere. It reads your
session files without changing them. When you send a message from the page it
runs your own Claude Code, and every action Claude Code asks permission for
waits for your Allow.`

interface Args {
  demo: boolean
  port: number
  dir?: string
  open: boolean
  readOnly: boolean
  claude?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = { demo: false, port: 4747, open: true, readOnly: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    const value = () => {
      const v = argv[++i]
      if (v === undefined) fail(`${a} needs a value`)
      return v
    }
    if (a === '--demo') args.demo = true
    else if (a === '--no-open') args.open = false
    else if (a === '--read-only') args.readOnly = true
    else if (a === '--claude') args.claude = value()
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

/** The full path of a command on PATH, or undefined. */
function findOnPath(command: string): string | undefined {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : ['']
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext)
      try {
        accessSync(candidate, constants.X_OK)
        return candidate
      } catch {
        // keep looking
      }
    }
  }
  return undefined
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

async function crewCommand(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv
  if (sub === 'list') {
    for (const a of await loadCrew()) console.log(`  /${a.command.padEnd(9)} ${a.title.padEnd(18)} ${a.short}`)
    return
  }
  if (sub !== 'install') fail('use: pitcrew crew install [--project <dir>] [--force], or pitcrew crew list')
  let target = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'))
  let force = false
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--project') target = path.join(path.resolve(rest[++i] ?? fail('--project needs a folder')), '.claude')
    else if (rest[i] === '--force') force = true
    else fail(`unknown option ${rest[i]}`)
  }
  const { written, kept } = await installCrew(target, force)
  console.log(`\n  The crew is in ${target}: ${written.length} file(s) written${kept.length ? `, ${kept.length} kept (already there; --force replaces them)` : ''}.`)
  console.log('  In Claude Code: /qa /review /security /tests /docs /deps, or "use the qa-tester agent".\n')
}

async function main(): Promise<void> {
  if (process.argv[2] === 'crew') return crewCommand(process.argv.slice(3))
  const args = parseArgs(process.argv.slice(2))
  let demo: Demo | undefined
  if (args.demo) demo = await startDemo()
  const root = demo?.root ?? args.dir ?? defaultRoot()

  // Talk needs Claude Code itself; the demo's projects are made up, so it stays read-only.
  const claude = args.readOnly || demo ? undefined : (args.claude ?? findOnPath('claude'))
  const token = randomBytes(24).toString('base64url')
  const server = await startServer({
    source: new ClaudeCodeSource(root),
    port: args.port,
    token,
    webDir: fileURLToPath(new URL('./web/', import.meta.url)),
    demo: Boolean(demo),
    talk: claude ? { claude, bridge: fileURLToPath(new URL('./talk/bridge.js', import.meta.url)) } : undefined,
  })
  const link = `${server.url}#t=${token}`

  console.log('')
  console.log(`  Pitcrew ${version()}${demo ? '  (demo: made-up sessions)' : ''}`)
  console.log(`  Watching  ${demo ? 'a demo folder' : root}`)
  console.log(`  Open      ${link}`)
  console.log(`  Talk      ${claude ? 'on: send messages from the page; actions wait for your Allow' : demo ? 'off in the demo' : args.readOnly ? 'off (--read-only)' : 'off: the claude command was not found (see --claude)'}`)
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
