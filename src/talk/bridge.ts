/**
 * The permission bridge. When Pitcrew runs a Claude Code session, Claude Code
 * starts this tiny MCP server (stdio) and calls its one tool, `approve`,
 * whenever it needs permission for something. The question goes to the
 * Pitcrew page; the answer comes back as allow or deny.
 *
 * Environment (set by Pitcrew): PITCREW_URL, PITCREW_BRIDGE_TOKEN, PITCREW_SESSION.
 */

const url = process.env.PITCREW_URL ?? ''
const token = process.env.PITCREW_BRIDGE_TOKEN ?? ''
const session = process.env.PITCREW_SESSION ?? ''

type Json = Record<string, unknown>

const TOOL = {
  name: 'approve',
  description: 'Asks the person watching in Pitcrew whether a tool may run.',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
}

function send(message: Json): void {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
}

async function call(path: string, init: RequestInit = {}): Promise<Json> {
  const res = await fetch(url + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Pitcrew answered ${res.status}`)
  return (await res.json()) as Json
}

/** Asks the page and waits, as long as it takes, for allow or deny. */
async function approve(args: Json): Promise<Json> {
  const input = (args.input ?? {}) as Json
  try {
    const { id } = await call('api/talk/asks', {
      method: 'POST',
      body: JSON.stringify({ session, tool: args.tool_name, input, toolUseId: args.tool_use_id }),
    })
    for (;;) {
      const d = await call(`api/talk/asks/${id}`)
      if (d.decided) {
        return d.allow ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: String(d.message ?? 'Denied in Pitcrew.') }
      }
    }
  } catch {
    return { behavior: 'deny', message: 'Pitcrew is not running, so nobody could say yes.' }
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  let nl: number
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (line) void handle(line)
  }
})

async function handle(line: string): Promise<void> {
  let msg: Json
  try {
    msg = JSON.parse(line) as Json
  } catch {
    return
  }
  const { id, method } = msg
  const params = (msg.params ?? {}) as Json
  if (id === undefined) return // a notification: nothing to answer
  switch (method) {
    case 'initialize':
      return send({ id, result: { protocolVersion: params.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'pitcrew', version: '1' } } })
    case 'tools/list':
      return send({ id, result: { tools: [TOOL] } })
    case 'tools/call': {
      if (params.name !== TOOL.name) return send({ id, error: { code: -32602, message: 'Unknown tool' } })
      const decision = await approve((params.arguments ?? {}) as Json)
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } })
    }
    default:
      return send({ id, result: {} })
  }
}
