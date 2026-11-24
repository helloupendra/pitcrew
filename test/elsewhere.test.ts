import { describe, expect, it } from 'vitest'
import { parsePs } from '../src/talk/elsewhere.js'

describe('parsePs', () => {
  it('keeps Claude Code processes only: the CLI and the editor extension, not the desktop app or Pitcrew', () => {
    const ps = [
      '  101 /opt/homebrew/bin/claude',
      '  102 /Users/sam/.vscode/extensions/anthropic.claude-code-2.1.0-darwin-arm64/resources/native-binary/claude --output-format stream-json --resume=11111111-1111-4111-8111-111111111111',
      '  103 /Applications/Claude.app/Contents/MacOS/Claude',
      '  104 node /Users/sam/code/pitcrew/dist/cli.js',
      '  105 /opt/homebrew/bin/claude -p --resume 22222222-2222-4222-8222-222222222222 --mcp-config {"mcpServers":{"pitcrew":{}}}',
      '  106 vim notes.md',
      '  107 node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js',
    ].join('\n')
    expect(parsePs(ps).map((p) => p.pid)).toEqual([101, 102, 107])
  })
})
