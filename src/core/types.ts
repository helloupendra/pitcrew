/**
 * The words Pitcrew uses for what a coding agent does. They do not depend on
 * which agent wrote the session: each source (Claude Code today) turns its own
 * files into these.
 */

export type SessionStatus = 'working' | 'waiting' | 'your-turn' | 'idle'

export type StepKind =
  | 'you' // a message you sent
  | 'agent' // a message the agent wrote
  | 'read' // it read a file or listed a folder
  | 'edit' // it changed part of a file
  | 'write' // it created or rewrote a whole file
  | 'run' // it ran a command
  | 'search' // it searched the code
  | 'web' // it opened a page or searched the web
  | 'helper' // it started a helper agent
  | 'plan' // it wrote or updated its plan
  | 'ask' // it asked you something
  | 'tool' // any other tool
  | 'note' // something happened to the session itself

export interface PlanItem {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** One line of a diff: unchanged, added, removed, or a gap between hunks. */
export interface DiffLine {
  t: ' ' | '+' | '-' | '~'
  s: string
}

export interface Step {
  /** Position in the session. Grows with time; earlier parts loaded later get lower numbers. */
  n: number
  id: string
  kind: StepKind
  at: string
  title: string
  text?: string
  path?: string
  command?: string
  output?: string
  diff?: DiffLine[]
  added?: number
  removed?: number
  plan?: PlanItem[]
  failed?: boolean
  /** The agent asked for this and nothing has come back yet. */
  pending?: boolean
}

export interface SessionSummary {
  id: string
  projectId: string
  title: string
  status: SessionStatus
  /** What it is doing right now, in plain words. */
  now: string
  startedAt?: string
  lastAt: string
  model?: string
  branch?: string
  linesAdded?: number
  linesRemoved?: number
  plan?: PlanItem[]
  sizeBytes: number
}

export interface Project {
  id: string
  name: string
  path: string
  branch?: string
  sessions: number
  working: number
  waiting: number
  lastAt: string
}

export interface FileTouched {
  path: string
  added: number
  removed: number
  created: boolean
  edits: number
}

export interface SessionDetail {
  summary: SessionSummary
  project: Pick<Project, 'id' | 'name' | 'path'>
  steps: Step[]
  /** Parts of the session before the first step returned exist. */
  hasEarlier: boolean
  /** Only the latest part of a long session is loaded. */
  partial: boolean
  files: FileTouched[]
  commands: { total: number; failed: number }
}

export interface Overview {
  projects: Project[]
  live: SessionSummary[]
  counts: { working: number; waiting: number; yourTurn: number }
  root: string
  demo: boolean
}
