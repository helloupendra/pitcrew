import { execFile } from 'node:child_process'
import { readlink } from 'node:fs/promises'

/**
 * Is a session open in another Claude Code window (VS Code, a terminal)?
 *
 * Session files do not say, so Pitcrew looks at running processes:
 *  - a Claude Code process whose command line names the session (`--resume=<id>`) holds it for sure;
 *  - a Claude Code process running in the session's folder may hold it: Claude Code does not keep
 *    the file open, and a session started fresh carries no id on its command line.
 * Either way Pitcrew will not continue the session in place, only in a copy.
 *
 * Works on macOS and Linux (ps, lsof or /proc). Elsewhere it finds nothing.
 */

export type Elsewhere = 'session' | 'folder' | undefined

export interface Proc {
  pid: number
  command: string
}

const FRESH_MS = 2_000
let cache: { at: number; procs: Promise<Proc[]> } | undefined

/** A Claude Code CLI or editor-extension process, not the desktop app and not Pitcrew. */
const CLAUDE_CODE = /(^|\/)claude(\s|$)|anthropic\.claude-code|@anthropic-ai\/claude-code/

export function parsePs(output: string): Proc[] {
  return output
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), command: m[2]! }))
    .filter((p) => CLAUDE_CODE.test(p.command) && !p.command.includes('pitcrew'))
}

export async function findElsewhere(sessionId: string, folder: string | undefined, own: Set<number>): Promise<Elsewhere> {
  const procs = (await claudeProcesses()).filter((p) => !own.has(p.pid))
  if (procs.some((p) => p.command.includes(sessionId))) return 'session'
  if (!folder || !procs.length) return undefined
  const cwds = await workingFolders(procs.map((p) => p.pid))
  return [...cwds.values()].some((cwd) => cwd === folder) ? 'folder' : undefined
}

function claudeProcesses(): Promise<Proc[]> {
  if (process.platform === 'win32') return Promise.resolve([])
  const now = Date.now()
  if (cache && now - cache.at < FRESH_MS) return cache.procs
  const procs = run('ps', ['-axo', 'pid=,command=']).then((out) => (out ? parsePs(out) : []))
  cache = { at: now, procs }
  return procs
}

/** The working folder of each process: /proc on Linux, lsof on macOS. */
async function workingFolders(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (process.platform === 'linux') {
    await Promise.all(
      pids.map(async (pid) => {
        const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => undefined)
        if (cwd) out.set(pid, cwd)
      }),
    )
    return out
  }
  const text = await run('lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids.join(',')])
  let pid = 0
  for (const line of (text ?? '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid) out.set(pid, line.slice(1))
  }
  return out
}

function run(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 3_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) =>
      // lsof exits 1 when some pid has gone; what it printed is still right.
      resolve(err && !stdout ? undefined : stdout),
    )
  })
}
