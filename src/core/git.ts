import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'

/** `git status` is cheap but not free: each folder is asked at most this often. */
const FRESH_MS = 15_000
const cache = new Map<string, { at: number; count: Promise<number | undefined> }>()

/**
 * How many files in a folder have changes not yet committed, or undefined when
 * the folder is gone, is not a git repository, or git is not installed.
 *
 * Read only: GIT_OPTIONAL_LOCKS=0 stops `git status` from refreshing the index
 * file, so Pitcrew never writes to your repository.
 */
export function uncommittedFiles(dir: string, now = Date.now()): Promise<number | undefined> {
  const hit = cache.get(dir)
  if (hit && now - hit.at < FRESH_MS) return hit.count
  const count = ask(dir)
  cache.set(dir, { at: now, count })
  return count
}

async function ask(dir: string): Promise<number | undefined> {
  try {
    if (!(await stat(dir)).isDirectory()) return undefined
  } catch {
    return undefined
  }
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', dir, 'status', '--porcelain', '--untracked-files=normal'],
      { timeout: 3_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, windowsHide: true },
      (err, stdout) => resolve(err ? undefined : stdout.split('\n').filter((l) => l.trim()).length),
    )
  })
}
