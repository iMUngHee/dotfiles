import type { Args, On, RenderElement, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE } from './register'

const SESSION = { surface: 'terminal' as const, isInteractive: true, cwd: '/work' }

const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}

const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'pager',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const COMMAND = {
  command: PANE,
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 160 },
}

type Message = { id: number; to: string; from: string; fromSession: string; body: string; human?: boolean }

const POLL = 5_000

function exited(exitCode: number, stdout: string, stderr = '') {
  return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

/** The pager CLI beneath pager-view, scripted: names per session, the store, the roster. */
// Fixture mail is stamped 05:<id % 60> on 2026-10-07; the clock starts at 06:00.
const NOW = Date.parse('2026-10-07T06:00:00.000Z')

function world(on: On, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  const w = {
    clock,
    sessionId: 'sid-a',
    names: { 'sid-a': 'wogi', 'sid-b': 'nuro' } as Record<string, string>,
    messages: [] as Message[],
    isInstalled: true,
    panes: [] as string[],
    runs: [] as Args<'process.run'>[],
    /** Set to hold the next export until the test lets it go. */
    hold: null as null | Promise<void>,
    beneath: null as null | string,
    who: 'NAME  TOOL    ROOT       HOST  LAST\nwogi  claude  /work      live  just now\nbuni  codex   /other     gone  3m ago\n',
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: w.sessionId }))
  on('ui.panes', () => ({
    value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.open', ($, e) => {
    if (!w.panes.includes(e.id)) w.panes.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('classic.SessionStart', () => ({}))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return w.beneath === null ? Box({ children: [] }) : Text({ children: [w.beneath] })
  })
  on('process.run', async ($, e) => {
    w.runs.push(e)
    if (!w.isInstalled) return { deny: 'spawn pager ENOENT' }
    const [, sub, , session] = e.argv
    if (sub === 'whoami') {
      const name = w.names[String(session)]
      return exited(0, `host:    claude\nsession: ${session} (via flag)\n${name ? `name:    ${name}\n` : ''}`)
    }
    if (sub === 'ls') {
      const mine = w.messages.filter(m => m.to === w.names[String(session)])
      if (mine.length === 0) return exited(0, 'nothing here\n')
      return exited(
        0,
        ['ID    INBOX  FROM  STATE      BODY', ...mine.map(m => `#${m.id}  ${m.to}  ${m.from}  delivered  ${m.body}`)].join('\n'),
      )
    }
    if (sub === 'export') {
      const held = w.hold
      const lines = w.messages.map(m =>
        JSON.stringify({
          v: 1,
          id: m.id,
          created_at: `2026-10-07T05:${String(m.id % 60).padStart(2, '0')}:00.000Z`,
          alias: m.to,
          sender_session: m.fromSession,
          sender_label: m.from,
          origin: m.human ? 'human' : 'agent',
          body: m.body,
        }),
      )
      if (held) await held
      return exited(0, lines.join('\n'))
    }
    if (sub === 'who') {
      return exited(0, w.who)
    }
    return exited(2, '', 'unexpected')
  })
  return w
}

function textOf(tree: unknown): string {
  if (tree === null || tree === undefined || typeof tree === 'boolean') return ''
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(textOf).join('')
  const node = tree as { type?: string; children?: unknown; props?: { children?: unknown; label?: string } }
  if (node.type === 'Button') return node.props?.label ?? ''
  const children = textOf(node.children ?? node.props?.children)
  return node.type === 'Box' ? `${children}\n` : children
}

async function bandText($: Engine, props = BAND): Promise<string> {
  const tree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props })
  return textOf(tree as RenderElement).trim()
}

const MAIL = (id: number, to = 'wogi'): Message => ({ id, to, from: 'buni', fromSession: 'sid-buni', body: `mail ${id}` })

async function started($: Engine, w: ReturnType<typeof world>): Promise<void> {
  await $.session.start(SESSION)
  await w.clock.advance(400)
}

describe('register', () => {
  test('mail that came before the first look is not new; mail after it is', async ($, on) => {
    const w = world(on)
    w.messages = [MAIL(10), MAIL(11)]
    await started($, w)
    expect(await bandText($)).toBe('✉ wogi  ← buni 49m  mail 11')

    w.messages.push(MAIL(12), MAIL(13))
    await w.clock.advance(POLL)
    expect(await bandText($)).toBe('✉ wogi  ● 2 new  ← buni 47m  mail 13')
  })

  test('/pager clears the badge, and mail arriving while it is open stays read', async ($, on) => {
    const w = world(on)
    await started($, w)
    w.messages.push(MAIL(20))
    await w.clock.advance(POLL)
    expect(await bandText($)).toBe('✉ wogi  ● 1 new  ← buni 40m  mail 20')

    await $.command.run(COMMAND)
    expect(await bandText($)).not.toContain('new')
    await w.clock.advance(400)

    w.messages.push(MAIL(21))
    await w.clock.advance(POLL)
    expect(await bandText($)).toBe('✉ wogi  ← buni 39m  mail 21')
  })

  test('the baseline is the store\'s: a reload under the same session keeps it', async ($, on) => {
    const w = world(on, { 'baseline:sid-a': 30 })
    w.messages = [MAIL(30), MAIL(31), MAIL(32)]
    await started($, w)

    expect(await bandText($)).toBe('✉ wogi  ● 2 new  ← buni 28m  mail 32')
  })

  test('a new session id starts its own baseline and drops the old one\'s view', async ($, on) => {
    const w = world(on, { 'baseline:sid-a': 0 })
    w.messages = [MAIL(40), MAIL(41, 'nuro')]
    await started($, w)
    expect(await bandText($)).toBe('✉ wogi  ● 1 new  ← buni 20m  mail 40')

    w.sessionId = 'sid-b'
    await $.classic.SessionStart({ source: 'clear' })
    await w.clock.advance(400)
    expect(await bandText($)).toBe('✉ nuro  ← buni 19m  mail 41  · 1 live')
  })

  test('a refresh still running when the session changes never lands in the new one', async ($, on) => {
    const w = world(on)
    w.messages = [MAIL(50)]
    await started($, w)
    let release = () => {}
    w.hold = new Promise(resolve => {
      release = resolve
    })
    await w.clock.advance(POLL)
    w.sessionId = 'sid-b'
    w.names['sid-b'] = ''
    w.hold = null
    await $.classic.SessionStart({ source: 'resume' })
    release()
    // Before sid-b's own refresh runs: sid-a's late result must not have landed.
    await w.clock.settle()
    expect(await bandText($)).toBe('')
    await w.clock.advance(400)
    expect(await bandText($)).toBe('')
  })

  test('the pane lists this session\'s conversation, then its peers', async ($, on) => {
    const w = world(on)
    w.messages = [
      MAIL(60),
      { id: 61, to: 'buni', from: 'wogi', fromSession: 'sid-a', body: 'reply\nsecond line' },
      { id: 62, to: 'wogi', from: 'gola', fromSession: 'sid-h', body: 'from 대협', human: true },
      MAIL(63, 'someone-else'),
    ]
    await started($, w)
    await $.command.run(COMMAND)
    await w.clock.advance(400)
    const ui = await $.ui.mount({ plugin: 'pager-view', surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: PANE })
    const text = textOf(await ui.drawn())

    expect(text).toContain('← buni  mail 60')
    expect(text).toContain('→ buni  reply ⏎ second line')
    expect(text).toContain('← gola  (human) from 대협')
    expect(text).not.toContain('mail 63')

    await ui.press({ key: 'tab-peers' })
    const peers = textOf(await ui.drawn())
    expect(peers).toContain('● wogi  claude just now  /work')
    expect(peers).toContain('○ buni  codex  3m ago    /other')
  })

  test('without pager, or without a name, nothing is drawn; the band keeps what is beneath', async ($, on) => {
    const w = world(on)
    w.isInstalled = false
    w.beneath = '▶ demo'
    await started($, w)
    expect(await bandText($)).toBe('▶ demo')

    w.isInstalled = true
    w.names['sid-a'] = ''
    await w.clock.advance(POLL)
    expect(await bandText($)).toBe('▶ demo')

    w.names['sid-a'] = 'wogi'
    await w.clock.advance(POLL)
    expect(await bandText($)).toBe('✉ wogi\n▶ demo')
    expect(await bandText($, { ...BAND, hasSurvey: true })).toBe('▶ demo')
  })

  test('the band shows the last message, live peers, and opens /pager from the name', async ($, on) => {
    const w = world(on)
    w.who = 'NAME  TOOL    ROOT    HOST  LAST\nwogi  claude  /work   live  just now\nbuni  codex   /other  live  1m ago\nzola  claude  /z      live  2m ago\n'
    w.messages = [
      MAIL(10),
      { id: 15, to: 'buni', from: 'wogi', fromSession: 'sid-a', body: `long ${'x'.repeat(80)}` },
    ]
    await started($, w)
    const text = await bandText($)
    expect(text).toContain('✉ wogi  → buni 45m  long ')
    expect(text).toContain('…  · 2 live')
    expect(text.length).toBeLessThan(120)

    w.messages.push(MAIL(16))
    await w.clock.advance(POLL)
    expect(await bandText($)).toContain('● 1 new')
    const band = await $.ui.mount({ plugin: 'pager-view', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await band.press({ key: 'open-pager' })
    expect(w.panes).toEqual([PANE])
    expect(await bandText($)).not.toContain('new')
  })

  test('drawing runs no process', async ($, on) => {
    const w = world(on)
    await started($, w)
    const before = w.runs.length
    await bandText($)
    await bandText($)

    expect(w.runs.length).toBe(before)
  })
})
