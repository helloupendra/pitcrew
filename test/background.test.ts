import { chmodSync, mkdtempSync, realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { backgroundChange, Talk } from '../src/talk/talk.js'

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-claude.mjs')
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function talk(idleMs: number) {
  chmodSync(fake, 0o755)
  process.env.FAKE_ROOT = mkdtempSync(path.join(tmpdir(), 'pitcrew-bg-root-'))
  return new Talk({ claude: fake, bridge: '/nonexistent', serverUrl: () => 'http://127.0.0.1:9/', bridgeToken: 'x', onChange: () => undefined, idleMs })
}

describe('background work', () => {
  it('counts helpers started in the background and the notices that they finished', () => {
    const started = { type: 'assistant', message: { content: [{ type: 'tool_use', input: { run_in_background: true } }, { type: 'tool_use', input: {} }] } }
    expect(backgroundChange(started, JSON.stringify(started))).toBe(1)
    const done = { type: 'user', message: { content: '<task-notification>x</task-notification>' } }
    expect(backgroundChange(done, JSON.stringify(done))).toBe(-1)
    const plain = { type: 'assistant', message: { content: [{ type: 'text', text: 'mentions <task-notification> in passing' }] } }
    expect(backgroundChange(plain, JSON.stringify(plain))).toBe(0)
  })

  it('keeps the process open while a helper works, and closes it once the helper reports back', async () => {
    const t = talk(200)
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'pitcrew-bg-')))
    const id = randomUUID()
    process.env.FAKE_BACKGROUND_MS = '900'
    t.send(id, cwd, 'start background work', 'new')
    await wait(600) // well past the 200 ms idle limit, while the helper still works
    expect(t.run(id)?.state).not.toBe('ended')
    for (let i = 0; i < 40 && t.run(id)?.state !== 'ended'; i++) await wait(100)
    expect(t.run(id)?.state).toBe('ended')
  })

  it('still closes a quiet process that started nothing in the background', async () => {
    const t = talk(200)
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'pitcrew-bg-')))
    const id = randomUUID()
    t.send(id, cwd, 'say ok', 'new')
    for (let i = 0; i < 30 && t.run(id)?.state !== 'ended'; i++) await wait(100)
    expect(t.run(id)?.state).toBe('ended')
  })
})
