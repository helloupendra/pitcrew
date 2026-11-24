import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { agentsFlag, installCrew, loadCrew, makeAgent, parseAgentFile, runPrompt } from '../src/crew/crew.js'

describe('the crew', () => {
  it('ships six agents, each a valid Claude Code agent file with a slash command', async () => {
    const crew = await loadCrew()
    expect(crew.map((a) => [a.id, a.command])).toEqual([
      ['qa-tester', 'qa'],
      ['code-reviewer', 'review'],
      ['security-auditor', 'security'],
      ['test-writer', 'tests'],
      ['docs-writer', 'docs'],
      ['dependency-doctor', 'deps'],
    ])
    for (const a of crew) {
      expect(a.description.length).toBeGreaterThan(40)
      expect(a.prompt.length).toBeGreaterThan(200)
      expect(a.tools).toContain('Read')
    }
    // reviewers and auditors only look; they may not edit
    expect(crew.find((a) => a.id === 'code-reviewer')!.tools).not.toContain('Edit')
    expect(crew.find((a) => a.id === 'security-auditor')!.tools).not.toContain('Write')
  })

  it('gives a session one agent through --agents, without installing anything', async () => {
    const qa = (await loadCrew())[0]!
    const json = JSON.parse(agentsFlag(qa)) as Record<string, { description: string; prompt: string; tools: string[] }>
    expect(Object.keys(json)).toEqual(['qa-tester'])
    expect(json['qa-tester']!.prompt).toContain('QA tester')
    expect(runPrompt('qa-tester', 'Check the login page')).toBe('Use the qa-tester agent for this: Check the login page')
  })

  it('reads agent files the way Claude Code writes them', () => {
    expect(parseAgentFile('---\nname: x\ndescription: "Does x"\ntools: Read, Bash\n---\nBe x.\n')).toEqual({ name: 'x', description: 'Does x', tools: ['Read', 'Bash'], prompt: 'Be x.' })
    expect(parseAgentFile('no front matter')).toBeUndefined()
  })

  it('installs into a .claude folder and keeps what is already there', async () => {
    const target = path.join(mkdtempSync(path.join(tmpdir(), 'pitcrew-crew-')), '.claude')
    const first = await installCrew(target)
    expect(first.written).toHaveLength(12)
    expect(existsSync(path.join(target, 'commands', 'qa.md'))).toBe(true)
    const again = await installCrew(target)
    expect([again.written.length, again.kept.length]).toEqual([0, 12])
    expect((await installCrew(target, true)).written).toHaveLength(12)
  })

  it('makes an agent of your own and never overwrites one', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'pitcrew-home-'))
    const file = await makeAgent({ name: 'Perf Checker!', description: 'Finds slow pages.', prompt: 'Measure.\nReport.', tools: ['Read', 'Bash', 'rm -rf'] }, home)
    expect(path.basename(file)).toBe('perf-checker.md')
    expect(parseAgentFile(readFileSync(file, 'utf8'))).toEqual({ name: 'perf-checker', description: 'Finds slow pages.', tools: ['Read', 'Bash'], prompt: 'Measure.\nReport.' })
    await expect(makeAgent({ name: 'perf checker', description: 'x', prompt: 'y', tools: [] }, home)).rejects.toThrow('already')
    await expect(makeAgent({ name: '!!!', description: 'x', prompt: 'y', tools: [] }, home)).rejects.toThrow('name')
  })
})
