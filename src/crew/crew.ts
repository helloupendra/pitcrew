import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The crew: specialist agents shipped with Pitcrew, as ordinary Claude Code
 * agent files (crew/agents/*.md) and slash commands (crew/commands/*.md).
 * They can be installed into Claude Code (`pitcrew crew install`) and used
 * without Pitcrew at all, or run from the page on any project.
 */

export interface CrewAgent {
  id: string
  title: string
  short: string
  /** What it does when run with one click. */
  task: string
  /** Its slash command once installed, e.g. "qa" for /qa. */
  command: string
  description: string
  tools: string[]
  prompt: string
}

/** An agent of your own, from ~/.claude/agents. */
export interface OwnAgent {
  id: string
  description: string
  file: string
}

export const CREW_DIR = fileURLToPath(new URL('../../crew/', import.meta.url))

export interface AgentFile {
  name: string
  description: string
  tools: string[]
  prompt: string
}

/** Reads a Claude Code agent file: YAML-style front matter (name, description, tools) and the prompt. */
export function parseAgentFile(text: string): AgentFile | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return undefined
  const fields = new Map<string, string>()
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line)
    if (kv) fields.set(kv[1]!, kv[2]!.trim().replace(/^["']|["']$/g, ''))
  }
  const name = fields.get('name')
  if (!name) return undefined
  const tools = (fields.get('tools') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  return { name, description: fields.get('description') ?? '', tools, prompt: m[2]!.trim() }
}

export async function loadCrew(dir = CREW_DIR): Promise<CrewAgent[]> {
  const meta = JSON.parse(await readFile(path.join(dir, 'crew.json'), 'utf8')) as Omit<CrewAgent, 'description' | 'tools' | 'prompt'>[]
  const out: CrewAgent[] = []
  for (const m of meta) {
    const file = parseAgentFile(await readFile(path.join(dir, 'agents', `${m.id}.md`), 'utf8'))
    if (file) out.push({ ...m, description: file.description, tools: file.tools, prompt: file.prompt })
  }
  return out
}

/** The agents in ~/.claude/agents (yours, or the crew once installed). */
export async function ownAgents(home = homedir()): Promise<OwnAgent[]> {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'agents')
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out: OwnAgent[] = []
  for (const n of names.filter((n) => n.endsWith('.md')).sort()) {
    const file = path.join(dir, n)
    const a = parseAgentFile(await readFile(file, 'utf8').catch(() => ''))
    if (a) out.push({ id: a.name, description: a.description, file })
  }
  return out
}

/** The --agents JSON that gives a Claude Code session one crew agent, without installing anything. */
export function agentsFlag(a: CrewAgent): string {
  return JSON.stringify({ [a.id]: { description: a.description, prompt: a.prompt, tools: a.tools } })
}

export function runPrompt(agentId: string, task: string): string {
  return `Use the ${agentId} agent for this: ${task}`
}

/** Copies the crew's agents and slash commands into a .claude folder. Existing files are kept unless `force`. */
export async function installCrew(target: string, force = false, dir = CREW_DIR): Promise<{ written: string[]; kept: string[] }> {
  const written: string[] = []
  const kept: string[] = []
  for (const kind of ['agents', 'commands']) {
    await mkdir(path.join(target, kind), { recursive: true })
    for (const n of (await readdir(path.join(dir, kind))).filter((n) => n.endsWith('.md'))) {
      const to = path.join(target, kind, n)
      if (!force && (await exists(to))) {
        kept.push(to)
        continue
      }
      await copyFile(path.join(dir, kind, n), to)
      written.push(to)
    }
  }
  return { written, kept }
}

/** Writes a new agent of your own to ~/.claude/agents/<name>.md. Never overwrites. */
export async function makeAgent(a: { name: string; description: string; prompt: string; tools: string[] }, home = homedir()): Promise<string> {
  const name = a.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  if (!name) throw new Error('Give the agent a name.')
  if (!a.description.trim() || !a.prompt.trim()) throw new Error('Say what the agent is for and how it should work.')
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), 'agents')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${name}.md`)
  if (await exists(file)) throw new Error(`There is already an agent called ${name}.`)
  const tools = a.tools.filter((t) => /^[A-Za-z]+$/.test(t))
  const head = ['---', `name: ${name}`, `description: ${oneLine(a.description)}`, ...(tools.length ? [`tools: ${tools.join(', ')}`] : []), '---']
  await writeFile(file, `${head.join('\n')}\n${a.prompt.trim()}\n`, { flag: 'wx' })
  return file
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
