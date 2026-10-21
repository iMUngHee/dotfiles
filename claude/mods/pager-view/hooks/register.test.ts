import type { Args, On, RenderElement, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { clockOf, dayOf } from './pager'
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
/** How often pager-view looks at the session id, well inside POLL. */
const WATCH = 1_000

function exited(exitCode: number, stdout: string, stderr = '') {
  return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
}

/** The pager CLI beneath pager-view, scripted: names per session, the store, the roster. */
// Fixture mail is stamped 05:<id % 60> on 2026-10-07; the clock starts at 06:00.
const NOW = Date.parse('2026-10-07T06:00:00.000Z')
const isoOf = (id: number) => `2026-10-07T05:${String(id % 60).padStart(2, '0')}:00.000Z`

function world(on: On, store: Record<string, unknown> = {}, env: Record<string, string> = { HOME: '/Users/u' }) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, store)
  mock.env(on, env)
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
          created_at: isoOf(m.id),
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

/** The band as text, a Box's line break once however the Boxes nest. */
async function bandText($: Engine, props = BAND): Promise<string> {
  const tree = await $.ui.render({ component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props })
  return textOf(tree as RenderElement).replace(/\n+/g, '\n').trim()
}

const MAIL = (id: number, to = 'wogi'): Message => ({ id, to, from: 'buni', fromSession: 'sid-buni', body: `mail ${id}` })

async function started($: Engine, w: ReturnType<typeof world>): Promise<void> {
  await $.session.start(SESSION)
  await w.clock.advance(400)
}

async function opened($: Engine, w: ReturnType<typeof world>, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.command.run(COMMAND)
  await w.clock.advance(400)
  return $.ui.mount({ plugin: 'pager-view', surface, component: 'Pane', props: PANE_PROPS, requestId: PANE })
}

type Found = { type: string; text: string; props: Record<string, unknown>; children: unknown[] }

/** A bubble row's child by a prop: the card has the round border, the spacer the width. */
function childOf(row: Found | undefined, test: (props: Record<string, unknown>) => boolean): Found | undefined {
  return (row?.children ?? []).find(
    (child): child is Found => typeof child === 'object' && child !== null && test((child as Found).props ?? {}),
  )
}
const cardOf = (row: Found | undefined) => childOf(row, props => props.borderStyle === 'round')
const spacerOf = (row: Found | undefined) => childOf(row, props => props.width === '20%')

/** The chips drawn: Texts whose own text is exactly `text` on a background. */
async function chips(ui: { findAll: (query: { type: string }) => Promise<Found[]> }, text: string): Promise<Found[]> {
  return (await ui.findAll({ type: 'Text' })).filter(one => one.text === text && one.props.backgroundColor !== undefined)
}

describe('band', () => {
  test('mail that came before the first look is not new; mail after it is', async ($, on) => {
    const w = world(on)
    w.messages = [MAIL(10), MAIL(11)]
    await started($, w)
    expect(await bandText($)).toBe('✉ wogi  ← buni 49m  mail 11')

    w.messages.push(MAIL(12), MAIL(13))
    await w.clock.advance(POLL)
    expect(await bandText($)).toBe('✉ wogi   2 new   ← buni 47m  mail 13')
  })

  test('/pager clears the badge, and mail arriving while it is open stays read', async ($, on) => {
    const w = world(on)
    await started($, w)
    w.messages.push(MAIL(20))
    await w.clock.advance(POLL)
    expect(await bandText($)).toBe('✉ wogi   1 new   ← buni 40m  mail 20')

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

    expect(await bandText($)).toBe('✉ wogi   2 new   ← buni 28m  mail 32')
  })

  test('a new session id starts its own baseline and drops the old one\'s view', async ($, on) => {
    const w = world(on, { 'baseline:sid-a': 0 })
    w.messages = [MAIL(40), MAIL(41, 'nuro')]
    await started($, w)
    expect(await bandText($)).toBe('✉ wogi   1 new   ← buni 20m  mail 40')

    // Only the id changes, with no event: the watch has to notice on its own.
    w.sessionId = 'sid-b'
    await w.clock.advance(WATCH)
    await w.clock.advance(400)
    expect(await bandText($)).toBe('✉ nuro  ← buni 19m  mail 41\n● 1 live')
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
    await w.clock.advance(WATCH)
    release()
    // sid-a's late result must not land in sid-b's band.
    await w.clock.settle()
    expect(await bandText($)).toBe('')
    await w.clock.advance(400)
    expect(await bandText($)).toBe('')
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

  test('the band shows the last message and pins the live count right; the name opens /pager', async ($, on) => {
    const w = world(on)
    w.who = 'NAME  TOOL    ROOT    HOST  LAST\nwogi  claude  /work   live  just now\nbuni  codex   /other  live  1m ago\nzola  claude  /z      live  2m ago\n'
    w.messages = [
      MAIL(10),
      { id: 15, to: 'buni', from: 'wogi', fromSession: 'sid-a', body: `long ${'x'.repeat(80)}` },
    ]
    await started($, w)
    const text = await bandText($)
    expect(text).toContain('✉ wogi  → buni 45m  long ')
    expect(text).toContain('…\n● 2 live')
    expect(text.length).toBeLessThan(120)
    const band = await $.ui.mount({ plugin: 'pager-view', surface: 'terminal', component: 'AbovePrompt', props: BAND })
    const live = await band.find({ text: /2 live/ })
    expect(live).toBeDefined()

    w.messages.push(MAIL(16))
    await w.clock.advance(POLL)
    expect(await bandText($)).toContain(' 1 new ')
    const [chip] = await chips(band, ' 1 new ')
    expect(chip?.props).toMatchObject({ backgroundColor: 'warning', color: 'inverseText', bold: true })
    await band.press({ key: 'open-pager' })
    expect(w.panes).toEqual([PANE])
    expect(await bandText($)).not.toContain('new')
  })
})

describe('chats', () => {
  test('the pane opens on the chats: conversations newest first, then quiet peers; this session is the header', async ($, on) => {
    const w = world(on)
    w.who = `${w.who}kiwi  codex   /k         live  1m ago\n`
    w.messages = [
      MAIL(60),
      { id: 61, to: 'buni', from: 'wogi', fromSession: 'sid-a', body: 'reply\nsecond line' },
      { id: 62, to: 'wogi', from: 'gola', fromSession: 'sid-h', body: 'from 대협', human: true },
      MAIL(63, 'someone-else'),
    ]
    await started($, w)
    const ui = await opened($, w)
    const text = textOf(await ui.drawn())

    expect(text).toContain(' wogi   ● 1 live')
    expect(text.split('wogi').length - 1).toBe(1)
    expect(text.indexOf('gola')).toBeLessThan(text.indexOf('buni'))
    expect(text.indexOf('buni')).toBeLessThan(text.indexOf('PEERS'))
    expect(text.indexOf('PEERS')).toBeLessThan(text.indexOf('kiwi'))
    expect(text).toContain('(human) from 대협')
    expect(text).toContain('you: reply ⏎ second line')
    expect(text).toContain('no messages yet · /k')
    expect(text).toContain('58m')
    expect(text).not.toContain('mail 63')
    // Two lines a chat, the cursor bar on the first: presence, name and tool, then the preview.
    expect(text).toMatch(/▌\n○\ngola\n\n58m\n/)
    expect(text).toMatch(/○\nbuni\ncodex\n\n59m\n/)
    expect(text).toMatch(/▌\n\(human\) from 대협\n/)
    expect(text).toContain('down')
    expect(text).toContain('· click a name')

    const desktop = await $.ui.mount({ plugin: 'pager-view', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: PANE })
    expect(textOf(await desktop.drawn())).toContain('click a name to open its chat')
  })

  test('unread is counted per room, clears when the room opens, and stays read while it is open', async ($, on) => {
    const w = world(on, { 'baseline:sid-a': 10 })
    w.messages = [MAIL(10), MAIL(11), { id: 12, to: 'wogi', from: 'lopu', fromSession: 'sid-l', body: 'hey' }]
    await started($, w)
    expect(await bandText($)).toBe('✉ wogi   2 new   ← lopu 48m  hey')

    const ui = await opened($, w)
    let text = textOf(await ui.drawn())
    expect(text).toContain(' · 2 unread')
    expect(await chips(ui, ' 1 ')).toHaveLength(2)

    // Opening scrolls the room to its newest bubble: this kit build answers a plugin's
    // $.ui.scroll with "no implementation for ui.scroll", so the terminal capture checks it.
    await ui.press({ key: 'chat-buni' })
    await ui.press({ key: 'back' })
    text = textOf(await ui.drawn())
    expect(text).toContain(' · 1 unread')
    await w.clock.advance(POLL)
    expect(textOf(await ui.drawn())).toContain(' · 1 unread')

    // Mail into the room on screen is read as it lands.
    await ui.press({ key: 'chat-buni' })
    w.messages.push(MAIL(13))
    await w.clock.advance(POLL)
    await ui.press({ key: 'back' })
    text = textOf(await ui.drawn())
    expect(text).toContain(' · 1 unread')
    expect(await chips(ui, ' 1 ')).toHaveLength(1)
  })

  test('j, k and o move the cursor and open its room; b returns; a new session returns to the chats', async ($, on) => {
    const w = world(on)
    w.who = `${w.who}kiwi  codex   /k         live  1m ago\n`
    w.messages = [MAIL(50)]
    await started($, w)
    const ui = await opened($, w)
    expect(textOf(await ui.drawn())).toMatch(/▌\n○\nbuni\n/)

    await ui.press({ key: 'down' })
    expect(textOf(await ui.drawn())).toMatch(/▌\n●\nkiwi\n/)
    await ui.press({ key: 'down' })
    expect(textOf(await ui.drawn())).toMatch(/▌\n●\nkiwi\n/)
    await ui.press({ key: 'open' })
    let text = textOf(await ui.drawn())
    expect(text).toContain('‹ chats')
    expect(text).toContain('kiwi  ● live · codex · /k')
    expect(text).toContain('No messages with kiwi yet.')

    await ui.press({ key: 'back' })
    await ui.press({ key: 'up' })
    expect(textOf(await ui.drawn())).toMatch(/▌\n○\nbuni\n/)

    await ui.press({ key: 'chat-buni' })
    w.sessionId = 'sid-b'
    await w.clock.advance(WATCH)
    await w.clock.advance(400)
    text = textOf(await ui.drawn())
    expect(text).toContain(' nuro ')
    expect(text).not.toContain('‹ chats')
  })

  test('the first look at the session id is no switch: a room opened at once stays open', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    expect(textOf(await ui.drawn())).toContain('‹ chats')

    await w.clock.advance(WATCH)
    expect(textOf(await ui.drawn())).toContain('‹ chats')
  })

  test('a long root is cut from its start, in the list and in the room, keeping the folder at its end', async ($, on) => {
    const w = world(on)
    w.who = `${w.who}vuba  claude  /Users/u/Library/${'x'.repeat(80)}/scratch-end  live  1m ago\n`
    await started($, w)
    const ui = await opened($, w)
    const row = textOf(await ui.drawn())
      .split('\n')
      .find(line => line.startsWith('no messages yet · …'))
    expect(row?.endsWith('xxx/scratch-end')).toBe(true)
    expect(row!.length).toBeLessThanOrEqual(78)

    await ui.press({ key: 'chat-vuba' })
    const header = textOf(await ui.drawn())
      .split('\n')
      .find(line => line.startsWith('vuba  ● live · claude · …'))
    expect(header?.endsWith('xxx/scratch-end')).toBe(true)
  })

  test('the seen map is the store\'s: a reload under the same session keeps what each room read', async ($, on) => {
    const w = world(on, { 'baseline:sid-a': 10, 'seen:sid-a': { buni: 11 } })
    w.messages = [MAIL(10), MAIL(11), MAIL(12)]
    await started($, w)
    const ui = await opened($, w)

    // 11 was read in buni's room before the reload; only 12 is unread.
    expect(textOf(await ui.drawn())).toContain(' · 1 unread')
    expect(await chips(ui, ' 1 ')).toHaveLength(1)
  })

  test('/pager opened anew starts on the chats; opened while up it stays in the room', async ($, on) => {
    const w = world(on)
    w.messages = [MAIL(80)]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    await $.command.run(COMMAND)
    expect(textOf(await ui.drawn())).toContain('‹ chats')

    // Closed, then opened again.
    w.panes = []
    await $.command.run(COMMAND)
    expect(textOf(await ui.drawn())).not.toContain('‹ chats')
  })

  test('without HOME a Windows root is shortened against USERPROFILE', async ($, on) => {
    const w = world(on, {}, { USERPROFILE: 'C:\\Users\\u' })
    w.who = 'NAME  TOOL    ROOT              HOST  LAST\nwogi  claude  C:\\Users\\u\\work  live  just now\nkiwi  codex   C:\\Users\\u\\k     live  1m ago\n'
    await started($, w)
    const ui = await opened($, w)

    expect(textOf(await ui.drawn())).toContain('no messages yet · ~\\k')
  })
})

describe('room', () => {
  test('received bubbles hug the left and sent ones the right, oldest first, under a day separator', async ($, on) => {
    const w = world(on)
    w.messages = [
      MAIL(30),
      { id: 31, to: 'buni', from: 'wogi', fromSession: 'sid-a', body: 'ack' },
      { id: 32, to: 'wogi', from: 'buni', fromSession: 'sid-buni', body: '대협 확인 부탁', human: true },
    ]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    const text = textOf(await ui.drawn())

    expect(text).toContain('‹ chats')
    expect(text).toContain('buni  ○ gone · codex · /other')
    expect(text).toContain(`── ${dayOf(isoOf(30))} ──`)
    expect(text.indexOf('mail 30')).toBeLessThan(text.indexOf('ack'))
    expect(text.indexOf('ack')).toBeLessThan(text.indexOf('대협 확인 부탁'))
    expect(text).toContain(clockOf(isoOf(31)))
    expect(text).toContain('(human) ')

    const received = (await ui.find({ key: 'bubble-30' })) as Found | undefined
    const sent = (await ui.find({ key: 'bubble-31' })) as Found | undefined
    expect(received?.props).toMatchObject({ flexDirection: 'row', justifyContent: 'flex-start' })
    expect(sent?.props).toMatchObject({ flexDirection: 'row', justifyContent: 'flex-end' })
    expect(cardOf(received)?.props).toMatchObject({ borderStyle: 'round', borderColor: 'subtle' })
    expect(cardOf(sent)?.props).toMatchObject({ borderStyle: 'round', borderColor: 'claude' })
    // The spacer sits opposite the bubble: after it when received, before it when sent.
    const at = (row: Found | undefined, child: Found | undefined) => row?.children.indexOf(child) ?? -1
    expect(at(received, cardOf(received))).toBeLessThan(at(received, spacerOf(received)))
    expect(at(sent, spacerOf(sent))).toBeLessThan(at(sent, cardOf(sent)))
    expect(at(received, spacerOf(received))).toBeGreaterThan(-1)
  })

  test('a long bubble folds at eight lines and unfolds in place; a body past the cap names the rest', async ($, on) => {
    const w = world(on)
    const long = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    w.messages = [
      { ...MAIL(40), body: long },
      { ...MAIL(41), body: 'ㄱ'.repeat(23_942) },
    ]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    let text = textOf(await ui.drawn())

    expect(text).toContain('line 8')
    expect(text).not.toContain('line 9')
    expect(text).toContain('▾ 12 more lines')
    // 6,000 syllables are 12,000 cells: 207 rows at the 58 a bubble wraps at in 80 columns.
    expect(text).toContain('▾ 199 more lines')
    expect(text).not.toContain('more characters')

    await ui.press({ key: 'fold-40' })
    text = textOf(await ui.drawn())
    expect(text).toContain('line 20')
    expect(text).toContain('▴ fold')

    await ui.press({ key: 'fold-41' })
    text = textOf(await ui.drawn())
    expect(text).toContain('ㄱ'.repeat(6_000))
    expect(text).not.toContain('ㄱ'.repeat(6_001))
    expect(text).toContain('… 17,942 more characters · full text: pager export (#41)')

    await ui.press({ key: 'fold-40' })
    text = textOf(await ui.drawn())
    expect(text).not.toContain('line 20')

    // `e` unfolds every folded bubble at once, then folds them all again.
    expect(text).toContain('unfold all')
    await ui.press({ key: 'fold-all' })
    text = textOf(await ui.drawn())
    expect(text).toContain('line 20')
    expect(text).toContain('more characters')
    expect(text).toContain('fold all')
    await ui.press({ key: 'fold-all' })
    text = textOf(await ui.drawn())
    expect(text).not.toContain('line 20')
    expect(text).not.toContain('more characters')
    expect((await ui.find({ key: 'fold-all' }))?.props).toMatchObject({ hotkey: 'e' })
  })

  test('unfolding many long bubbles stays inside the drawing budget, the newest and the controls kept', async ($, on) => {
    const w = world(on)
    // Twenty capped bodies: 120,000 characters unfolded, past the engine's 100,000.
    w.messages = Array.from({ length: 20 }, (_, i) => ({ ...MAIL(100 + i), body: `id${100 + i} ${'x'.repeat(6_100)}` }))
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    await ui.press({ key: 'fold-all' })
    const text = textOf(await ui.drawn())

    expect(text.length).toBeLessThan(100_000)
    expect(text).toContain('id119 ')
    expect(text).toMatch(/\d+ earlier messages not shown/)
    expect(await ui.find({ key: 'fold-all' })).toBeDefined()
    // And `e` folds them all again, the hidden ones included: every bubble is back.
    await ui.press({ key: 'fold-all' })
    const folded = textOf(await ui.drawn())
    expect(folded).not.toContain('earlier messages not shown')
    expect(folded).toContain('id100 ')
  })

  test('drawing runs no process', async ($, on) => {
    const w = world(on)
    w.messages = [MAIL(70)]
    await started($, w)
    const ui = await opened($, w)
    const before = w.runs.length
    await bandText($)
    await ui.drawn()
    await ui.press({ key: 'chat-buni' })
    await ui.drawn()

    expect(w.runs.length).toBe(before)
  })
})
