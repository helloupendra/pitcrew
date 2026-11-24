/**
 * Made-up sessions for `pitcrew --demo`. Nothing here comes from a real project.
 * Each event becomes one or two lines in the same format Claude Code writes.
 */

export type DemoEvent =
  | { you: string }
  | { say: string; final?: boolean }
  | { tool: string; input: Record<string, unknown>; result?: string; error?: boolean; created?: boolean; pending?: boolean }

export interface DemoSession {
  cwd: string
  branch: string
  title: string
  /** Minutes since the last event; omitted for the session that plays live. */
  endedMinutesAgo?: number
  events: DemoEvent[]
}

const todo = '/Users/you/code/todo-app'
const api = '/Users/you/code/api-server'
const docs = '/Users/you/code/docs-site'
const mobile = '/Users/you/code/mobile-app'

const plan = (done: number, items: string[]) => ({
  tool: 'TodoWrite',
  input: {
    todos: items.map((content, i) => ({ content, activeForm: content, status: i < done ? 'completed' : i === done ? 'in_progress' : 'pending' })),
  },
  result: 'Todos have been modified successfully.',
})

const darkModePlan = ['Find the header component', 'Add a theme hook that remembers the choice', 'Add the toggle button and dark colours', 'Run the tests']

/** Plays live, line by line, while the demo runs. */
export const live: DemoSession = {
  cwd: todo,
  branch: 'feat/dark-mode',
  title: 'Add a dark mode toggle',
  events: [
    { you: 'Add a dark mode toggle to the header. It should remember the choice after a reload.' },
    { say: "I'll look at how the header and the colours are set up first." },
    plan(0, darkModePlan),
    { tool: 'Grep', input: { pattern: 'function Header', path: `${todo}/src` }, result: 'Found 1 file\nsrc/components/Header.tsx' },
    { tool: 'Read', input: { file_path: `${todo}/src/components/Header.tsx` }, result: '(file contents)' },
    { tool: 'Read', input: { file_path: `${todo}/src/styles/theme.css` }, result: '(file contents)' },
    { say: 'The colours are already CSS variables, so dark mode only needs a second set of values and a switch.' },
    plan(1, darkModePlan),
    {
      tool: 'Write',
      created: true,
      input: {
        file_path: `${todo}/src/hooks/useTheme.ts`,
        content: [
          "import { useEffect, useState } from 'react'",
          '',
          "export type Theme = 'light' | 'dark'",
          '',
          'export function useTheme() {',
          "  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) ?? 'light')",
          '',
          '  useEffect(() => {',
          '    document.documentElement.dataset.theme = theme',
          "    localStorage.setItem('theme', theme)",
          '  }, [theme])',
          '',
          "  const toggle = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))",
          '  return { theme, toggle }',
          '}',
        ].join('\n'),
      },
      result: `File created successfully at: ${todo}/src/hooks/useTheme.ts`,
    },
    plan(2, darkModePlan),
    {
      tool: 'Edit',
      input: {
        file_path: `${todo}/src/components/Header.tsx`,
        old_string: [
          "import { Logo } from './Logo'",
          '',
          'export function Header() {',
          '  return (',
          '    <header className="header">',
          '      <Logo />',
          '    </header>',
          '  )',
        ].join('\n'),
        new_string: [
          "import { Logo } from './Logo'",
          "import { useTheme } from '../hooks/useTheme'",
          '',
          'export function Header() {',
          '  const { theme, toggle } = useTheme()',
          '  return (',
          '    <header className="header">',
          '      <Logo />',
          '      <button className="theme-toggle" onClick={toggle} aria-label="Switch theme">',
          "        {theme === 'light' ? '☾' : '☀'}",
          '      </button>',
          '    </header>',
          '  )',
        ].join('\n'),
      },
      result: 'The file has been updated.',
    },
    {
      tool: 'Edit',
      input: {
        file_path: `${todo}/src/styles/theme.css`,
        old_string: [':root {', '  --bg: #ffffff;', '  --text: #1c1c1e;', '}'].join('\n'),
        new_string: [':root {', '  --bg: #ffffff;', '  --text: #1c1c1e;', '}', '', "[data-theme='dark'] {", '  --bg: #141416;', '  --text: #ececf1;', '}'].join('\n'),
      },
      result: 'The file has been updated.',
    },
    plan(3, darkModePlan),
    {
      tool: 'Bash',
      input: { command: 'npm test', description: 'Run the tests' },
      error: true,
      result: [
        '> todo-app@1.4.0 test',
        '> vitest run',
        '',
        ' ✓ src/hooks/useTodos.test.ts (9 tests)',
        ' ✓ src/components/TodoList.test.tsx (4 tests)',
        ' ✗ src/components/Header.test.tsx (1 test | 1 failed)',
        '   × Header > renders the title',
        '     ReferenceError: localStorage is not defined',
        '      ❯ src/hooks/useTheme.ts:6:58',
        '',
        ' Tests  1 failed | 13 passed (14)',
      ].join('\n'),
    },
    { say: 'One test fails: the test runs outside a browser, where there is no localStorage. I will read it only when it exists.' },
    {
      tool: 'Edit',
      input: {
        file_path: `${todo}/src/hooks/useTheme.ts`,
        old_string: "  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem('theme') as Theme) ?? 'light')",
        new_string: [
          '  const [theme, setTheme] = useState<Theme>(() =>',
          "    typeof localStorage === 'undefined' ? 'light' : ((localStorage.getItem('theme') as Theme) ?? 'light'),",
          '  )',
        ].join('\n'),
      },
      result: 'The file has been updated.',
    },
    {
      tool: 'Bash',
      input: { command: 'npm test', description: 'Run the tests again' },
      result: [
        '> todo-app@1.4.0 test',
        '> vitest run',
        '',
        ' ✓ src/hooks/useTodos.test.ts (9 tests)',
        ' ✓ src/components/TodoList.test.tsx (4 tests)',
        ' ✓ src/components/Header.test.tsx (1 test)',
        '',
        ' Tests  14 passed (14)',
      ].join('\n'),
    },
    plan(4, darkModePlan),
    {
      say: 'Done. The header has a ☾/☀ button that switches the theme; the choice is saved and comes back after a reload. All 14 tests pass.',
      final: true,
    },
  ],
}

export const finished: DemoSession[] = [
  {
    cwd: api,
    branch: 'fix/flaky-login',
    title: 'Fix the flaky login test',
    endedMinutesAgo: 2,
    events: [
      { you: 'The login test fails about one run in five on CI. Find out why and fix it.' },
      { tool: 'Read', input: { file_path: `${api}/tests/login.test.ts` }, result: '(file contents)' },
      { tool: 'Grep', input: { pattern: 'setTimeout', path: `${api}/tests` }, result: 'tests/login.test.ts:41:    await new Promise((r) => setTimeout(r, 100))' },
      { say: 'The test waits a fixed 100 ms for the session cookie. On a slow CI machine the cookie comes later, so the test reads nothing.' },
      {
        tool: 'Edit',
        input: {
          file_path: `${api}/tests/login.test.ts`,
          old_string: '    await new Promise((r) => setTimeout(r, 100))\n    const cookie = jar.get(\'session\')',
          new_string: "    const cookie = await waitFor(() => jar.get('session'), { timeout: 5_000 })",
        },
        result: 'The file has been updated.',
      },
      { tool: 'Bash', input: { command: 'npm test -- login --repeat 50', description: 'Run the login test 50 times' }, result: ' Tests  50 passed (50)' },
      { tool: 'Bash', input: { command: 'git commit -am "Wait for the session cookie instead of sleeping"', description: 'Commit the fix' }, result: '[fix/flaky-login 3e1a9c2] Wait for the session cookie instead of sleeping\n 1 file changed, 1 insertion(+), 2 deletions(-)' },
      { tool: 'Bash', input: { command: 'git push origin fix/flaky-login', description: 'Push the fix' }, pending: true },
    ],
  },
  {
    cwd: api,
    branch: 'feat/rate-limit',
    title: 'Add rate limiting to the public API',
    endedMinutesAgo: 6,
    events: [
      { you: 'Add rate limiting to the public API routes. Keep it simple.' },
      { tool: 'Read', input: { file_path: `${api}/src/server.ts` }, result: '(file contents)' },
      {
        tool: 'Write',
        created: true,
        input: {
          file_path: `${api}/src/middleware/rateLimit.ts`,
          content: [
            "import type { Request, Response, NextFunction } from 'express'",
            '',
            'const WINDOW_MS = 60_000',
            'const LIMIT = 60',
            'const hits = new Map<string, { count: number; resetAt: number }>()',
            '',
            'export function rateLimit(req: Request, res: Response, next: NextFunction) {',
            "  const key = req.header('x-api-key') ?? req.ip ?? 'anonymous'",
            '  const now = Date.now()',
            '  const entry = hits.get(key)',
            '  if (!entry || entry.resetAt < now) {',
            '    hits.set(key, { count: 1, resetAt: now + WINDOW_MS })',
            '    return next()',
            '  }',
            '  if (++entry.count > LIMIT) {',
            "    res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000))",
            "    return res.status(429).json({ error: 'Too many requests' })",
            '  }',
            '  next()',
            '}',
          ].join('\n'),
        },
        result: `File created successfully at: ${api}/src/middleware/rateLimit.ts`,
      },
      {
        tool: 'Edit',
        input: {
          file_path: `${api}/src/server.ts`,
          old_string: "app.use('/api/public', publicRoutes)",
          new_string: "app.use('/api/public', rateLimit, publicRoutes)",
        },
        result: 'The file has been updated.',
      },
      { tool: 'Bash', input: { command: 'npm test', description: 'Run the tests' }, result: ' Tests  38 passed (38)' },
      { say: 'Rate limiting is in: 60 requests a minute per API key, then 429 with a Retry-After header. Should the admin routes get a different limit?', final: true },
    ],
  },
  {
    cwd: docs,
    branch: 'main',
    title: 'Write the getting-started guide',
    endedMinutesAgo: 190,
    events: [
      { you: 'Write a short getting-started guide: install, first run, where to go next.' },
      { tool: 'Glob', input: { pattern: 'docs/**/*.md' }, result: 'docs/index.md\ndocs/config.md\ndocs/faq.md' },
      { tool: 'Read', input: { file_path: `${docs}/docs/index.md` }, result: '(file contents)' },
      {
        tool: 'Write',
        created: true,
        input: {
          file_path: `${docs}/docs/getting-started.md`,
          content: ['# Getting started', '', '## Install', '', '```sh', 'npm install', '```', '', '## First run', '', '```sh', 'npm run dev', '```', '', 'Open http://localhost:3000.', '', '## Next', '', '- [Configuration](config.md)', '- [FAQ](faq.md)'].join('\n'),
        },
        result: `File created successfully at: ${docs}/docs/getting-started.md`,
      },
      { tool: 'Bash', input: { command: 'npm run build', description: 'Build the docs site' }, result: 'Built 4 pages in 1.2s' },
      { say: 'The guide is at docs/getting-started.md and the site builds.', final: true },
    ],
  },
  {
    cwd: docs,
    branch: 'main',
    title: 'Fix broken links',
    endedMinutesAgo: 1_500,
    events: [
      { you: 'Some links in the docs are broken. Find and fix them.' },
      {
        tool: 'Agent',
        input: { description: 'Check every link in the docs', subagent_type: 'Explore', prompt: 'List every link in docs/ that points to a missing page.' },
        result: 'Found 2 broken links:\n- docs/faq.md → setup.md (the page is now getting-started.md)\n- docs/config.md → /api (no such page)',
      },
      { tool: 'Edit', input: { file_path: `${docs}/docs/faq.md`, old_string: 'See [setup](setup.md).', new_string: 'See [Getting started](getting-started.md).' }, result: 'The file has been updated.' },
      { tool: 'Edit', input: { file_path: `${docs}/docs/config.md`, old_string: 'the [API](/api)', new_string: 'the API' }, result: 'The file has been updated.' },
      { say: 'Fixed both broken links.', final: true },
    ],
  },
  {
    cwd: mobile,
    branch: 'chore/upgrade',
    title: 'Upgrade the app to the new navigation library',
    endedMinutesAgo: 3_100,
    events: [
      { you: 'Upgrade the navigation library to the latest major version.' },
      { tool: 'Bash', input: { command: 'npm install @app/navigation@latest', description: 'Install the new version' }, result: 'added 3 packages, changed 2 packages in 4s' },
      { tool: 'Bash', input: { command: 'npx tsc --noEmit', description: 'Check the types' }, result: 'src/App.tsx(12,10): error TS2305: Module has no exported member "Stack".', error: true },
      { tool: 'Edit', input: { file_path: `${mobile}/src/App.tsx`, old_string: "import { Stack } from '@app/navigation'", new_string: "import { createStack } from '@app/navigation'\n\nconst Stack = createStack()" }, result: 'The file has been updated.' },
      { tool: 'Bash', input: { command: 'npx tsc --noEmit', description: 'Check the types again' }, result: '' },
      { say: 'Upgraded; the one breaking change (Stack is now created with createStack) is fixed and the types check.', final: true },
    ],
  },
]
