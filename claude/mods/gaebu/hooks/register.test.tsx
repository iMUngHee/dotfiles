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
  on('clock.now', () => ({ value: 1_000_000 }))
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
  on('clock.now', () => ({ value: 1_000_000 }))
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
  await ui.press({ key: 'nav-organization' })
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
  opts: { status?: (text: string | undefined) => void; session?: () => string; run?: (argv: string[]) => ReturnType<typeof ran> | Promise<ReturnType<typeof ran>> } = {},
) {
  on('session.id', () => ({ value: opts.session?.() ?? 's-1' }))
  on('command.register', () => ({ value: { command: 'gaebu' } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 1_000_000 }))
  on('ui.status', (_, e) => {
    opts.status?.((e as { text?: string }).text)
    return { value: undefined }
  })
  on('process.run', (_, e) => (opts.run ?? defaultRun)((e as { argv: string[] }).argv))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

test('pane orders duties by stage', async ($, on) => {
  mountedWith(on, { run: argv => argv.includes('me') && argv.includes('--json') ? ran(JSON.stringify({ ...CARD, superior: null })) : defaultRun(argv) })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const rows = (await ui.findAll({ type: 'Text', text: /^(>| ) d-[789]/ })).map(r => r.text ?? '')
  expect(rows.map(r => r.match(/d-\d/)?.[0])).toEqual(['d-8', 'd-9', 'd-7'])
  expect(rows[0]).toContain('[보류] hook')
  expect(await ui.find({ type: 'Text', text: /대협 확인 후/ })).toBeDefined()
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
  await ui.press({ key: 'nav-organization' })
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
  expect(await ui.find({ type: 'Text', text: /비어 있습니다/ })).toBeDefined()
  await ui.unmount()
})

test('prompt.compose stamps the hook only with the card in, at most every ten minutes', async ($, on) => {
  const calls: string[][] = []
  let now = 1_000_000
  let id = 's-1'
  let isMember = false
  on('session.id', () => ({ value: id }))
  on('command.register', () => ({ value: { command: 'gaebu' } }))
  on('clock.every', () => ({ value: undefined }))
  on('clock.now', () => ({ value: now }))
  on('ui.status', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    const argv = (e as { argv: string[] }).argv
    calls.push(argv)
    return isMember || !argv.includes('me') ? defaultRun(argv) : ran('', 1)
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => e)
  on('prompt.compose', () => ({ sections: [] }))
  const stamps = (session: string) =>
    calls.filter(a => a.join(' ').includes(`session heartbeat --session ${session} --compose`)).length
  const request = {
    model: 'm',
    promptModel: 'm',
    surfaces: [],
    tools: [],
    outputStyle: null,
    traits: [],
  } as const

  // No seat, no section: nothing reached the model, so nothing is stamped.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect((await $.prompt.compose(request)).sections.length).toBe(0)
  expect(stamps('s-1')).toBe(0)

  isMember = true
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const first = await $.prompt.compose(request)
  expect(first.sections.some(s => s.id === 'gaebu:card')).toBe(true)
  await $.prompt.compose(request)
  expect(stamps('s-1')).toBe(1)
  now += 600_000
  await $.prompt.compose(request)
  expect(stamps('s-1')).toBe(2)

  // /clear starts a new session id, which gets its own stamp at once.
  id = 's-2'
  await $.prompt.submit({ text: 'x', origin: { kind: 'unclassified' } } as never)
  await $.prompt.compose(request)
  expect(stamps('s-2')).toBe(1)
})

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}

/** A rendered tree as text: a Button by its label, a Box as a line. */
function textOf(tree: unknown): string {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  const node = tree as { type?: string; children?: unknown; props?: { children?: unknown; label?: string } }
  if (node.type === 'Button') return node.props?.label ?? ''
  const children = textOf(node.children ?? node.props?.children)
  return node.type === 'Box' ? `${children}\n` : children
}

async function bandText($: Parameters<TestBody>[0], props = BAND): Promise<string> {
  const tree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props })
  return textOf(tree).replace(/\n+/g, '\n').trim()
}

test('the band shows my seat and what waits, or that I hold none', async ($, on) => {
  let isMember = false
  const opened: string[] = []
  mountedWith(on, {
    run: argv => (isMember || !argv.includes('me') ? defaultRun(argv) : ran(JSON.stringify({ reason: 'not_member', message: 'session has no member' }), 1)),
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: ['below'] })
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(await bandText($)).toBe('개부  이 세션은 아직 편성되지 않았습니다\nbelow')

  isMember = true
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(await bandText($)).toBe('개부 좌장군부 속관 주부 bepo  소임 1 · 대기 1\nbelow')
  // A survey owns the space above the prompt.
  expect(await bandText($, { ...BAND, hasSurvey: true })).toBe('below')
  // The name is the way into /gaebu.
  const band = await $.ui.mount({ plugin: 'gaebu', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  await band.press({ key: 'open-gaebu' })
  expect(opened).toEqual(['gaebu-board'])
  await band.unmount()
})

const SCHEDULE = {
  registered: true,
  schedule_id: 'schedule-map',
  path: 'C:/project/schedule.md',
  revision: 4,
  manager: { member: 'm-3', alias: 'bepo', mode: 'delegated', state: 'bound' },
  items: [
    {
      id: 'S-018', title: '한글·한자 지명 검색과 출처 표기의 통합 검수', stage: 'review', stage_label: '검수 대기',
      reasons: ['구현 인계 완료'], priority: 1, scope: ['viewer/**'],
      owner_bu: { runtime_id: 'runtime-1', team: 't-1', id: 'b-1' }, owner_display: '좌장군부',
      master: { member: 'm-1', alias: 'nuzu' }, pm_ref: { task: 'MAP', item: 'search', plan: '.agents/plans/search.md' },
      dispatches: [], completion: null, next_action: '결과를 검수하고 다음 작업을 배정합니다',
    },
    {
      id: 'S-019', title: '후속 접근성 검증', stage: 'ready', stage_label: '준비', reasons: [], priority: 2,
      scope: ['viewer/**'], owner_bu: null, owner_display: null, master: null, pm_ref: null, dispatches: [],
      completion: null, next_action: '책임 부를 정합니다',
    },
  ],
}

function operationsRun(argv: string[], opts: { failed?: boolean; reversed?: boolean; alias?: string } = {}) {
  if (opts.failed && argv.includes('me')) return ran(JSON.stringify({ reason: 'busy', message: 'state lock timed out' }), 1)
  const schedule = { ...SCHEDULE, items: opts.reversed ? [...SCHEDULE.items].reverse() : SCHEDULE.items }
  const card = { ...CARD, alias: opts.alias ?? CARD.alias, schedule }
  if (argv.includes('me') && argv.includes('--json')) return ran(JSON.stringify(card))
  if (argv.includes('me')) return ran('[개부] current contract')
  if (argv.includes('board')) return ran(JSON.stringify({ ...BOARD, token: 'schedule-4', teams: BOARD.teams.map(t => ({ ...t, schedule })) }))
  return ran('')
}

test('operations overview connects selected work to full detail and nested organization', async ($, on) => {
  mountedWith(on, { run: argv => operationsRun(argv) })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 160, rows: 50 }, props: { ...PANE.props, bodyColumns: 160 } })
  expect(await ui.find({ type: 'Text', text: /지금 판단할 일/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /결과를 검수하고 다음 작업을 배정합니다/ })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'operations-split' })).toBeDefined()
  await ui.press({ key: 'nav-detail' })
  expect(await ui.find({ type: 'Text', text: /MAP.*search/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\.agents\/plans\/search.md/ })).toBeDefined()
  await ui.press({ key: 'nav-organization' })
  expect(await ui.find({ type: 'Button', text: /승상부/ })).toBeDefined()
  await ui.press({ key: 'nav-help' })
  expect(await ui.find({ type: 'Text', text: /키보드 \/ 조회 전용/ })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'filter-attention' })
  await ui.press({ key: 'move-next' })
  await ui.press({ key: 'move-prev' })
  await ui.press({ key: 'nav-overview' })
  const controls = JSON.stringify(await ui.drawn())
  for (const hotkey of ['o', 'g', 'd', 'j', 'k', 'f', 'r', 'b', 'h']) expect(controls).toContain(`"hotkey":"${hotkey}"`)
  await ui.unmount()
})

test('attention filter retains dispatching work with a reconciliation action', async ($, on) => {
  const schedule = { ...SCHEDULE, items: [{ ...SCHEDULE.items[0], stage: 'dispatching', stage_label: '배정 복구 대기',
    reasons: ['배정 저장 후 연결 확인 필요'], next_action: 'schedule reconcile로 배정을 복구합니다' }, SCHEDULE.items[1]] }
  mountedWith(on, { run: argv => argv.includes('me') && argv.includes('--json') ? ran(JSON.stringify({ ...CARD, schedule })) : operationsRun(argv) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'filter-attention' })
  expect(await ui.find({ type: 'Button', key: 'select-S-018' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /schedule reconcile로 배정을 복구합니다/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'select-S-019' })).toBeUndefined()
  await ui.unmount()
})

test('narrow pane uses its body width rather than the wider terminal viewport', async ($, on) => {
  mountedWith(on, { run: argv => operationsRun(argv) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 160, rows: 24 }, props: { ...PANE.props, bodyColumns: 80 } })
  expect(await ui.find({ type: 'Box', key: 'operations-stack' })).toBeDefined()
  expect(await ui.find({ type: 'Box', key: 'operations-split' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'nav-help' })).toBeDefined()
  await ui.unmount()
  for (const bodyColumns of [117, 118]) {
    const boundary = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 160, rows: 24 }, props: { ...PANE.props, bodyColumns } })
    const boundaryTree = await boundary.drawn()
    expect(JSON.stringify(boundaryTree)).toContain(bodyColumns === 117 ? 'operations-stack' : 'operations-split')
    await boundary.unmount()
  }
})

test('refresh preserves selected stable item across reordered snapshots', async ($, on) => {
  let reversed = false
  mountedWith(on, { run: argv => operationsRun(argv, { reversed }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'move-next' })
  reversed = true
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'nav-detail' })
  expect(await ui.find({ type: 'Text', text: /S-019.*전체 계약/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /책임 부를 정합니다/ })).toBeDefined()
  await ui.unmount()
})

test('failed refresh preserves last good snapshot with explicit stale recovery', async ($, on) => {
  let failed = false
  mountedWith(on, { run: argv => operationsRun(argv, { failed }) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  failed = true
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /STALE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /state lock timed out/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /S-018/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'refresh' })).toBeDefined()
  await ui.unmount()
})

test('not_member and failed first read remain distinct states', async ($, on) => {
  let reason = 'not_member'
  mountedWith(on, { run: argv => argv.includes('me') ? ran(JSON.stringify({ reason, message: reason === 'not_member' ? 'session has no member' : 'state read failed' }), 1) : defaultRun(argv) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /편성되지 않았습니다/ })).toBeDefined()
  reason = 'store_corrupt'
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /ERROR/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /state read failed/ })).toBeDefined()
  await ui.unmount()
})

test('refresh requests never run concurrent session reads', async ($, on) => {
  let hold = false
  let calls = 0
  let active = 0
  let peak = 0
  let release: () => void = () => {}
  let started: () => void = () => {}
  const blocking = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { started = resolve })
  mountedWith(on, { run: async argv => {
    if (hold && argv.includes('me') && argv.includes('--json')) {
      calls += 1
      active += 1
      peak = Math.max(peak, active)
      started()
      await blocking
      active -= 1
    }
    return operationsRun(argv)
  } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  hold = true
  const first = ui.press({ key: 'refresh' })
  await entered
  const second = ui.press({ key: 'refresh' })
  await Promise.resolve()
  release()
  await Promise.all([first, second])
  expect(calls).toBeGreaterThan(0)
  expect(peak).toBe(1)
  await ui.unmount()
})

test('a late old-session response cannot replace the current session snapshot', async ($, on) => {
  let id = 'old-session'
  let hold = false
  let release: () => void = () => {}
  let started: () => void = () => {}
  const blocking = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { started = resolve })
  mountedWith(on, { session: () => id, run: async argv => {
    const old = argv.includes('old-session')
    if (hold && old && argv.includes('me') && argv.includes('--json')) { started(); await blocking }
    return operationsRun(argv, { alias: old ? 'old-alias' : 'new-alias' })
  } })
  on('prompt.submit', (_, e) => e)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  hold = true
  const pending = ui.press({ key: 'refresh' })
  await entered
  id = 'new-session'
  await $.prompt.submit({ text: 'continue', origin: { kind: 'unclassified' } } as never)
  release()
  await pending
  expect(await ui.find({ type: 'Text', text: /new-alias/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /old-alias/ })).toBeUndefined()
  await ui.unmount()
})

test('malformed nested schedule data is rejected before replacing last good state', async ($, on) => {
  let malformed = false
  mountedWith(on, { run: argv => malformed && argv.includes('me') && argv.includes('--json')
    ? ran(JSON.stringify({ ...CARD, schedule: { registered: true, items: 'broken' } }))
    : operationsRun(argv) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  malformed = true
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ type: 'Text', text: /STALE/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /잘못된 개부 조회 응답/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /S-018/ })).toBeDefined()
  await ui.unmount()
})

test('completed dispatch detail loads the full persisted brief and caches it until refresh', async ($, on) => {
  let reads = 0
  const path = 'C:/project/.agents/worktrees/' + '아주긴작업이름'.repeat(15)
  const schedule = { ...SCHEDULE, items: [{ ...SCHEDULE.items[0], dispatches: [{ key: 'review', token: 'token-1', assignee: { runtime_id: 'runtime-1', team: 't-1', id: 'm-3' }, duty: 'd-completed', status: 'done' }] }] }
  mountedWith(on, { run: argv => {
    if (argv.includes('duty') && argv.includes('show')) {
      reads += 1
      expect(argv.at(-1)).toBe('s-1')
      return ran(JSON.stringify({ ...duty('d-completed', 'ended', '종료'), status: 'done', outcome: '완료 결과', intent: '검색과 출처를 연결', plan_ref: '.agents/plans/search.md', exec_root: path, source: { quote: '한글·한자 검색과 출처를 확인해' }, note: '42 tests pass', version: 3 }))
    }
    if (argv.includes('me') && argv.includes('--json')) return ran(JSON.stringify({ ...CARD, schedule }))
    return operationsRun(argv)
  } })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'nav-detail' })
  expect(await ui.find({ type: 'Text', text: path })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '한글·한자 검색과 출처를 확인해' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '42 tests pass' })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'nav-detail' })
  expect(reads).toBe(1)
  await ui.unmount()
})

test('cancelled schedule work keeps its live duty out of standalone working rows', async ($, on) => {
  const linked = { ...duty('d-cancelled-live', 'working', '진행'), outcome: 'standalone duplicate must stay hidden' }
  const schedule = { ...SCHEDULE, counts: { total: 1, cancelled: 1, retired: 44 }, items: [{ ...SCHEDULE.items[0],
    id: 'w-cancelled', title: 'cancelled work needing cleanup', stage: 'cancelled', stage_label: '취소',
    next_action: '남은 소임과 자원을 정리한다', dispatches: [{ key: 'cleanup', token: 'x-1',
      assignee: { runtime_id: 'runtime-1', team: 't-1', id: 'm-3' }, duty: linked.id, status: 'accepted' }] }] }
  mountedWith(on, { run: argv => argv.includes('me') && argv.includes('--json')
    ? ran(JSON.stringify({ ...CARD, duties: [linked], schedule })) : operationsRun(argv) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'select-w-cancelled' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'select-d-cancelled-live' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /남은 소임과 자원을 정리한다/ })).toBeDefined()
  await ui.unmount()
})

test('detail scroll controls keep the selected contract instead of changing tasks', async ($, on) => {
  mountedWith(on, { run: argv => operationsRun(argv) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'nav-detail' })
  expect(await ui.find({ type: 'Text', text: '상태' })).toBeDefined()
  await ui.press({ key: 'move-next' })
  expect(await ui.find({ type: 'Text', text: /S-018.*전체 계약/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '상태' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /필드 2\// })).toBeDefined()
  await ui.unmount()
})

test('another runtime member with the same local id is not counted as my work', async ($, on) => {
  const schedule = { ...SCHEDULE, manager: { ...SCHEDULE.manager, member: 'm-1' }, viewer: { runtime_id: 'runtime-1', team: 't-1', id: 'm-3' },
    items: [{ ...SCHEDULE.items[0], title: '다른 컴퓨터의 작업', master: null, owner_bu: { runtime_id: 'another-runtime', team: 't-1', id: 'b-1' }, stage: 'unknown',
      dispatches: [{ key: 'foreign', token: 'foreign-1', assignee: { runtime_id: 'another-runtime', team: 't-1', id: 'm-3' }, duty: null, status: 'unknown' }] }] }
  mountedWith(on, { run: argv => argv.includes('me') && argv.includes('--json') ? ran(JSON.stringify({ ...CARD, schedule })) : operationsRun(argv) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /다른 컴퓨터의 작업/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /hook adapter/ })).toBeDefined()
  await ui.unmount()
})

test('large queues keep the selected stable row inside the bounded visible slice', async ($, on) => {
  const schedule = { ...SCHEDULE, items: Array.from({ length: 80 }, (_, index) => ({ ...SCHEDULE.items[0], id: `S-${index + 1}`, title: `긴 작업 ${index + 1}`, stage: 'working', stage_label: '진행', reasons: [] })) }
  mountedWith(on, { run: argv => argv.includes('me') && argv.includes('--json') ? ran(JSON.stringify({ ...CARD, schedule })) : operationsRun(argv) })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: 80, rows: 24 }, props: { ...PANE.props, scroll: { offset: 0, bodyRows: 24 } } })
  for (let index = 0; index < 20; index += 1) await ui.press({ key: 'move-next' })
  expect(await ui.find({ type: 'Button', key: 'select-S-21' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /작업 .*\/83/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button', text: /긴 작업/ })).length).toBeLessThan(20)
  await ui.unmount()
})

test('native render evidence covers operations states at both adaptation extremes', async ($, on) => {
  let mode = 'overview'
  let session = 'render'
  const longTitle = '한글·한자 지명 검색과 사료 출처를 함께 확인하는 아주 긴 통합 검수 작업'
  const base = { ...SCHEDULE, viewer: { runtime_id: 'runtime-1', team: 't-1', id: 'm-3' }, items: [{ ...SCHEDULE.items[0], title: longTitle,
    dispatches: [{ key: 'render', token: 'render-1', assignee: { runtime_id: 'runtime-1', team: 't-1', id: 'm-3' }, duty: 'd-full', status: 'done' }] }, SCHEDULE.items[1]] }
  mountedWith(on, { session: () => session, run: argv => {
    if (mode === 'error' || mode === 'stale') return argv.includes('me') ? ran(JSON.stringify({ reason: 'busy', message: 'schedule read failed' }), 1) : operationsRun(argv)
    if (mode === 'not_member' && argv.includes('me')) return ran(JSON.stringify({ reason: 'not_member', message: 'session has no member' }), 1)
    let schedule = mode === 'empty' ? { ...base, items: [] } : mode === 'unregistered' ? { registered: false, items: [] }
      : mode === 'dispatching' ? { ...base, items: [{ ...base.items[0], stage: 'dispatching', stage_label: '배정 복구 대기', next_action: 'schedule reconcile로 배정을 복구합니다' }, base.items[1]] }
      : mode === 'unknown' ? { ...base, manager: { ...base.manager, state: 'quiet' } }
      : mode === 'worker' ? { ...base, manager: { ...base.manager, member: 'm-1' } } : base
    if (argv.includes('duty') && argv.includes('show')) return ran(JSON.stringify({ ...duty('d-full', 'ended', '종료'), intent: '원문과 결과를 보존', outcome: longTitle,
      plan_ref: '.agents/plans/search-and-source-provenance.md', exec_root: 'C:/workspace/map/.agents/worktrees/search-and-source-provenance',
      source: { quote: '한글·한자 검색과 출처를 확인해' }, note: '42 tests pass', version: 4 }))
    if (argv.includes('me') && argv.includes('--json')) return ran(JSON.stringify({ ...CARD, schedule }))
    if (argv.includes('me')) return ran('[개부] render fixture')
    if (mode === 'partial' && argv.includes('board')) return ran(JSON.stringify({ reason: 'pager_unavailable', message: 'session observation unavailable' }), 1)
    if (argv.includes('board')) return ran(JSON.stringify({ ...BOARD, token: `render-${mode}`, teams: BOARD.teams.map(team => ({ ...team, schedule, bus: [
      { ...team.bus[0], parent: null }, { id: 'b-child', name: '좌장군부', head: '좌장군 nuzu', status: 'open', parent: 'b-1', members: [
        { id: 'm-pending', display: '참군 soju', binding: 'pending', duties: [], leases: [] },
        { id: 'm-quiet', display: '주부 paga', binding: 'quiet', duties: [], leases: [] },
      ] },
    ] })) }))
    return ran('')
  } })
  for (const width of [80, 160]) {
    const height = width === 80 ? 24 : 50
    for (const state of ['overview', 'organization', 'detail', 'help', 'worker', 'empty', 'unregistered', 'unknown', 'partial', 'stale', 'error', 'not_member', 'dispatching']) {
      mode = state === 'stale' ? 'overview' : state
      session = `render-${width}-${state}`
      await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal', viewport: { columns: width, rows: height }, props: { ...PANE.props, bodyColumns: width, scroll: { offset: 0, bodyRows: height } } })
      if (state === 'organization') await ui.press({ key: 'nav-organization' })
      if (state === 'detail') await ui.press({ key: 'nav-detail' })
      if (state === 'help') await ui.press({ key: 'nav-help' })
      if (state === 'dispatching') await ui.press({ key: 'filter-attention' })
      if (state === 'stale') { mode = 'stale'; await ui.press({ key: 'refresh' }) }
      const tree = await ui.drawn()
      const encoded = JSON.stringify(tree)
      expect(encoded).toContain('"backgroundColor":"claude"')
      expect(encoded).toContain('"hotkey":"h"')
      expect(encoded).not.toMatch(/#[0-9a-fA-F]{6}/)
      if (state === 'overview') expect(encoded).toContain('"inverse":true')
      if (state === 'detail') expect(await ui.find({ type: 'Text', text: /search-and-source-provenance/ })).toBeDefined()
      if (state === 'organization') expect(await ui.find({ type: 'Text', text: /관측 오래됨, 종료 아님/ })).toBeDefined()
      if (state === 'error') expect(await ui.find({ type: 'Text', text: /ERROR/ })).toBeDefined()
      if (state === 'stale') expect(await ui.find({ type: 'Text', text: /STALE/ })).toBeDefined()
      if (state === 'dispatching') expect(await ui.find({ type: 'Button', key: 'select-S-018' })).toBeDefined()
      await ui.unmount()
    }
  }
})
