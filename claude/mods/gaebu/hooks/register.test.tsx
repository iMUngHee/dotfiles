import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const CARD = {
  rev: 3,
  member: 'm-3',
  alias: 'bepo',
  title: '주부',
  team: 'gaebu',
  bu: '좌장군부',
  binding: 'bound',
  chain: ['대협', '가절월을 받은 승상 gapu', '좌장군 nuzu', '좌장군부 속관 주부 bepo'],
  superior: '좌장군 nuzu',
  duties: [
    {
      id: 'd-1',
      status: 'accepted',
      stage: 'held',
      stage_label: '보류',
      hold: '대협 확인 후',
      outcome: 'hook adapter',
      scope: ['src/hook.rs'],
      done_criteria: 'cargo test',
      decision_rights: 'internals',
    },
  ],
  peers: ['좌장군 nuzu'],
  leases: [],
  escalations: [],
  cancels: [],
  norms: [],
  hash: 'h',
}

const BOARD = {
  rev: 3,
  token: 'tok-1',
  teams: [
    {
      id: 't-1',
      name: 'gaebu',
      status: 'active',
      commander: '가절월을 받은 승상 gapu',
      bus: [
        {
          id: 'b-1',
          name: '승상부',
          status: 'open',
          head: '승상 gapu',
          members: [
            { id: 'm-1', display: '승상 gapu', binding: 'bound', duties: [], leases: [] },
            {
              id: 'm-3',
              display: '승상부 속관 주부 bepo',
              binding: 'bound',
              // Deliberately out of order: the pane sorts by stage.
              duties: [
                { ...duty('d-7', 'working', '진행'), outcome: 'docs' },
                { ...duty('d-8', 'held', '보류'), outcome: 'hook', hold: '대협 확인 후' },
                { ...duty('d-9', 'awaiting_acceptance', '수락 대기'), outcome: 'mcp' },
              ],
              leases: [],
            },
          ],
        },
      ],
    },
  ],
  user_queue: [],
}

function duty(id: string, stage: string, stage_label: string) {
  return {
    id,
    status: 'accepted',
    stage,
    stage_label,
    outcome: '',
    scope: [],
    done_criteria: '',
    decision_rights: '',
  }
}

const PANE = {
  plugin: 'gaebu',
  component: 'Pane',
  requestId: 'gaebu-board',
  props: {
    title: '개부 명부',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

function ran(stdout: string, exitCode = 0) {
  return {
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }
}

test('session start heartbeats, reads the card and sets the status line', async ($, on) => {
  const calls: string[][] = []
  const statuses: (string | undefined)[] = []
  on('session.id', () => ({ value: 's-1' }))
  on('command.register', () => ({ value: { command: 'gaebu' } }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    statuses.push((e as { text?: string }).text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    calls.push(argv)
    if (argv.includes('me') && argv.includes('--json')) return ran(JSON.stringify(CARD))
    if (argv.includes('me')) return ran('[개부] card text')
    if (argv.includes('board')) return ran(JSON.stringify(BOARD))
    return ran('')
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(calls.some(a => a.join(' ').includes('session heartbeat --session s-1 --mod'))).toBe(true)
  expect(calls.some(a => a.join(' ').includes('me --session s-1'))).toBe(true)
  expect(statuses.some(s => (s ?? '').includes('좌장군부 속관 주부 bepo'))).toBe(true)
})

test('the roster pane shows the commander after a refresh', async ($, on) => {
  on('session.id', () => ({ value: 's-1' }))
  on('command.register', () => ({ value: { command: 'gaebu' } }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    if (argv.includes('me') && argv.includes('--json')) return ran(JSON.stringify(CARD))
    if (argv.includes('me')) return ran('[개부] card text')
    if (argv.includes('board')) return ran(JSON.stringify(BOARD))
    return ran('')
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ type: 'Text', text: /승상 gapu/ })
  expect(row).toBeDefined()
  await ui.unmount()
})

test('an empty roster says so', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const row = await ui.find({ type: 'Text', text: /비어 있습니다/ })
  expect(row).toBeDefined()
  await ui.unmount()
})

test('only a composer-stamped prompt is recorded as evidence', async ($, on) => {
  const calls: { argv: string[]; stdin?: string }[] = []
  on('session.id', () => ({ value: 's-1' }))
  on('command.register', () => ({ value: { command: 'gaebu' } }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const call = e as { argv: string[]; init?: { stdin?: string } }
    calls.push({ argv: call.argv, stdin: call.init?.stdin })
    return ran('', 1)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => e)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await $.prompt.submit({ text: '너한테 가절월 줄게', origin: { kind: 'composer' } } as never)
  await $.prompt.submit({ text: 'pager: new mail for gapu', origin: { kind: 'unclassified' } } as never)

  const evidence = calls.filter(c => c.argv.includes('evidence'))
  expect(evidence.length).toBe(1)
  expect(evidence[0]?.stdin).toBe('너한테 가절월 줄게')
})

test('evidence follows the current session id after /clear', async ($, on) => {
  const calls: string[][] = []
  let id = 'old-session'
  on('session.id', () => ({ value: id }))
  on('command.register', () => ({ value: { command: 'gaebu' } }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    calls.push((e as { argv: string[] }).argv)
    return ran('', 1)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => e)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  id = 'new-session'
  await $.prompt.submit({ text: '개부해라', origin: { kind: 'composer' } } as never)

  const evidence = calls.filter(a => a.includes('evidence'))
  expect(evidence.at(-1)?.at(-1)).toBe('new-session')
})

type On = Parameters<TestBody>[1]

function defaultRun(argv: string[]) {
  if (argv.includes('me') && argv.includes('--json')) return ran(JSON.stringify(CARD))
  if (argv.includes('me')) return ran('[개부] card text')
  if (argv.includes('board')) return ran(JSON.stringify(BOARD))
  return ran('')
}

function mountedWith(
  on: On,
  opts: { status?: (text: string | undefined) => void; run?: (argv: string[]) => ReturnType<typeof ran> } = {},
) {
  on('session.id', () => ({ value: 's-1' }))
  on('command.register', () => ({ value: { command: 'gaebu' } }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', (_, e) => {
    opts.status?.((e as { text?: string }).text)
    return { value: undefined }
  })
  on('process.run', (_, e) => (opts.run ?? defaultRun)((e as { argv: string[] }).argv))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('pane orders duties by stage', async ($, on) => {
  mountedWith(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const rows = (await ui.findAll({ type: 'Text', text: /소임 d-/ })).map(r => r.text ?? '')
  expect(rows.map(r => r.match(/d-\d/)?.[0])).toEqual(['d-8', 'd-9', 'd-7'])
  expect(rows[0]).toContain('[보류] hook — 대협 확인 후')
  await ui.unmount()
})

test('the status line counts duties waiting on someone', async ($, on) => {
  const statuses: (string | undefined)[] = []
  mountedWith(on, { status: t => statuses.push(t) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(statuses.some(s => (s ?? '').includes('대기 1'))).toBe(true)
})

test('the next board refresh passes the token it holds', async ($, on) => {
  const calls: string[][] = []
  mountedWith(on, {
    run: argv => {
      calls.push(argv)
      if (argv.includes('board') && argv.includes('--since')) return ran(JSON.stringify({ unchanged: true }))
      return defaultRun(argv)
    },
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'gaebu', args: '' } as never)
  const boards = calls.filter(a => a.includes('board'))
  expect(boards.at(-1)?.join(' ')).toContain('--since tok-1')
  // `unchanged` keeps the board it had.
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /승상 gapu/ })).toBeDefined()
  await ui.unmount()
})

test('old card-1/board-1 values are discarded', async ($, on) => {
  // What v0.1 stored: duties as plain strings, no stage, no token.
  on('state.get', () => ({
    value: {
      value: {
        rev: 1,
        teams: [
          {
            id: 't-1',
            name: 'old',
            status: 'active',
            commander: 'old commander',
            bus: [
              {
                id: 'b-1',
                name: '승상부',
                status: 'open',
                head: 'x',
                members: [{ id: 'm-1', display: 'x', binding: 'bound', duties: ['d-1 [accepted] x'], leases: [] }],
              },
            ],
          },
        ],
        user_queue: [],
      },
      version: 1,
    },
  }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toMatch(/비어 있습니다/)
  await ui.unmount()
})
