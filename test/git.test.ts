import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { uncommittedFiles } from '../src/core/git.js'
import { activityByDay } from '../src/sources/claude-code/source.js'

describe('uncommittedFiles', () => {
  it('counts changed and new files without touching the repo', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pitcrew-git-'))
    execFileSync('git', ['init', '-q', dir])
    writeFileSync(path.join(dir, 'a.txt'), 'a')
    writeFileSync(path.join(dir, 'b.txt'), 'b')
    expect(await uncommittedFiles(dir)).toBe(2)
  })

  it('knows nothing about folders that are gone or not repos', async () => {
    expect(await uncommittedFiles('/no/such/folder')).toBeUndefined()
    expect(await uncommittedFiles(mkdtempSync(path.join(tmpdir(), 'pitcrew-nogit-')))).toBeUndefined()
  })
})

describe('activityByDay', () => {
  it('counts a session on every day it was active, today last', () => {
    const now = new Date(2026, 2, 10, 15, 0).getTime() // 10 Mar, local time
    const at = (d: number, h = 12) => new Date(2026, 2, d, h).toISOString()
    expect(
      activityByDay(
        [
          { startedAt: at(10, 9), lastAt: at(10, 10) },
          { startedAt: at(8), lastAt: at(9) }, // two days
          { lastAt: at(4) }, // the first day shown
          { lastAt: at(1) }, // too old
        ],
        now,
      ),
    ).toEqual([1, 0, 0, 0, 1, 1, 1])
  })
})
