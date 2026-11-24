#!/usr/bin/env node
// A stand-in for `claude -p --input-format stream-json --output-format stream-json` in tests.
// It writes a session file like Claude Code would, and for a message containing "ask"
// it asks for permission through the MCP bridge it was given, exactly as Claude Code does.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const id = flag('--session-id') ?? flag('--resume')
const bridge = JSON.parse(flag('--mcp-config')).mcpServers.pitcrew
const cwd = process.cwd()
const file = path.join(process.env.FAKE_ROOT, cwd.replace(/[/.]/g, '-'), `${id}.jsonl`)
mkdirSync(path.dirname(file), { recursive: true })

const write = (line) =>
  appendFileSync(file, JSON.stringify({ isSidechain: false, cwd, sessionId: id, uuid: randomUUID(), timestamp: new Date().toISOString(), ...line }) + '\n')
const out = (event) => process.stdout.write(JSON.stringify(event) + '\n')

out({ type: 'system', subtype: 'init', session_id: id })

let buf = ''
let queue = Promise.resolve()
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl)
    buf = buf.slice(nl + 1)
    queue = queue.then(() => onMessage(JSON.parse(line)))
  }
})
process.stdin.on('end', () => queue.then(() => process.exit(0)))

async function onMessage(m) {
  const text = m.message.content[0].text
  write({ type: 'user', message: { role: 'user', content: text } })
  if (text.includes('background')) {
    // Like a helper agent started with run_in_background: the turn ends at once,
    // and a task-notification arrives later as a new turn.
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bg', name: 'Agent', input: { description: 'helper', run_in_background: true } }] } })
    out({ type: 'result', subtype: 'success', is_error: false, result: 'started a helper' })
    await new Promise((r) => setTimeout(r, Number(process.env.FAKE_BACKGROUND_MS ?? 700)))
    out({ type: 'user', message: { role: 'user', content: '<task-notification><summary>helper done</summary></task-notification>' } })
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'The helper finished.' }] } })
    out({ type: 'result', subtype: 'success', is_error: false, result: 'helper done' })
    return
  }
  if (text.includes('ask')) {
    const input = { command: 'echo hi', description: 'Say hi' }
    write({ type: 'assistant', message: { role: 'assistant', model: 'fake', content: [{ type: 'tool_use', id: 'toolu_fake', name: 'Bash', input }], stop_reason: 'tool_use' } })
    const decision = await approve('Bash', input)
    write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fake', content: decision.behavior, is_error: decision.behavior !== 'allow' }] } })
    out({ type: 'result', subtype: 'success', is_error: false, result: decision.behavior })
  } else {
    write({ type: 'assistant', message: { role: 'assistant', model: 'fake', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } })
    out({ type: 'result', subtype: 'success', is_error: false, result: 'ok' })
  }
}

/** Speaks MCP to the bridge: initialize, then call its approve tool. */
function approve(tool, input) {
  const child = spawn(bridge.command, bridge.args, { env: { ...process.env, ...bridge.env }, stdio: ['pipe', 'pipe', 'inherit'] })
  const waiting = new Map()
  let pending = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    pending += chunk
    let nl
    while ((nl = pending.indexOf('\n')) >= 0) {
      const msg = JSON.parse(pending.slice(0, nl))
      pending = pending.slice(nl + 1)
      waiting.get(msg.id)?.(msg)
    }
  })
  const request = (rpcId, method, params) =>
    new Promise((resolve) => {
      waiting.set(rpcId, resolve)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }) + '\n')
    })
  return request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake', version: '1' } })
    .then(() => request(2, 'tools/call', { name: 'approve', arguments: { tool_name: tool, input, tool_use_id: 'toolu_fake' } }))
    .then((msg) => {
      child.kill()
      return JSON.parse(msg.result.content[0].text)
    })
}
