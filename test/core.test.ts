import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lineDiff, patchToDiff } from '../src/core/diff.js'
import { readLines } from '../src/core/lines.js'
import { statusOf } from '../src/sources/claude-code/status.js'
import type { Step } from '../src/core/types.js'

describe('lineDiff', () => {
  it('keeps shared lines and marks the changed ones', () => {
    expect(lineDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { t: ' ', s: 'a' },
      { t: '-', s: 'b' },
      { t: '+', s: 'B' },
      { t: ' ', s: 'c' },
      { t: '+', s: 'd' },
    ])
  })

  it('stays bounded on huge changes', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n')
    const out = lineDiff(big, big.replace(/line/g, 'row'))
    expect(out.length).toBe(401)
    expect(out.at(-1)).toEqual({ t: '~', s: '3600 more lines not shown' })
  })
})

describe('patchToDiff', () => {
  it('reads hunks and separates them', () => {
    expect(patchToDiff([{ lines: ['-a', '+b'] }, { lines: [' c'] }])).toEqual([
      { t: '-', s: 'a' },
      { t: '+', s: 'b' },
      { t: '~', s: '' },
      { t: ' ', s: 'c' },
    ])
    expect(patchToDiff(undefined)).toBeUndefined()
  })
})

describe('readLines', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pitcrew-test-'))
  const file = path.join(dir, 'f.jsonl')
  writeFileSync(file, 'one\ntwo\nthree\nhalf')

  it('returns whole lines only and leaves an unfinished last line for later', async () => {
    const all = await readLines(file, 0, 18)
    expect(all.lines).toEqual(['one', 'two', 'three'])
    expect(all.readTo).toBe(14)
  })

  it('drops a line cut by the start, but not one that starts exactly there', async () => {
    expect((await readLines(file, 1, 18)).lines).toEqual(['two', 'three'])
    expect((await readLines(file, 4, 18)).lines).toEqual(['two', 'three'])
    expect((await readLines(file, 4, 18)).firstLineAt).toBe(4)
  })
})

describe('statusOf', () => {
  const step = (over: Partial<Step>): Step => ({ n: 0, id: 'x', kind: 'run', at: '', title: 'Run the tests', pending: true, ...over })

  it('says working while a tool runs, and waiting when it has been quiet too long', () => {
    expect(statusOf({ kind: 'tool' }, [step({})], undefined, 5_000)).toEqual({ status: 'working', now: 'Running: Run the tests' })
    expect(statusOf({ kind: 'tool' }, [step({})], undefined, 60_000).status).toBe('waiting')
    expect(statusOf({ kind: 'tool' }, [step({ kind: 'edit', title: 'Edited a.ts' })], undefined, 1_000).now).toBe('Editing a.ts')
  })

  it('treats a question to you as waiting at once', () => {
    expect(statusOf({ kind: 'tool' }, [step({ kind: 'ask', title: 'Asked you: Which colour?' })], undefined, 1_000)).toEqual({ status: 'waiting', now: 'Asked you: Which colour?' })
  })

  it('says your turn when the agent finished or was stopped', () => {
    expect(statusOf({ kind: 'agent-text', final: true }, [], 'All tests pass.', 60_000)).toEqual({ status: 'your-turn', now: 'Finished: All tests pass.' })
    expect(statusOf({ kind: 'stopped', why: 'you' }, [], undefined, 1_000).now).toBe('You stopped it')
  })

  it('goes idle after a long silence, whatever happened last', () => {
    expect(statusOf({ kind: 'tool' }, [step({})], undefined, 31 * 60_000).status).toBe('idle')
    expect(statusOf({ kind: 'prompt' }, [], undefined, 11 * 60_000)).toEqual({ status: 'idle', now: 'Stopped without finishing' })
  })
})
