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
  if (node.type === 'Markdown') return `${(node.props as { text?: string } | undefined)?.text ?? ''}
`
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

/** Every Box drawn, for its border and fill props. */
async function boxes(ui: { findAll: (query: { type: string }) => Promise<Found[]> }): Promise<Found[]> {
  return ui.findAll({ type: 'Box' })
}

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
  test('the pane opens on the chats: conversations alone, newest first; this session is the header', async ($, on) => {
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
    // kiwi is live but never talked with this session: no row, and no group for such peers.
    expect(text).not.toContain('kiwi')
    expect(text).not.toContain('PEERS')
    expect(text).not.toContain('no messages yet')
    expect(text).toContain('you: reply ⏎ second line')
    expect(text).toContain('58m')
    expect(text).not.toContain('mail 63')
    // Two lines a chat, the cursor bar on the first: presence, name and tool, then who said what.
    expect(text).toMatch(/▌\n○\ngola\n\n58m\n/)
    expect(text).toMatch(/▌\n\(human\) gola: from 대협\n/)
    expect(text).toMatch(/○\nbuni\ncodex\n\n59m\n/)
    expect(text).toContain('down')
    expect(text).toContain('· click a name')

    const desktop = await $.ui.mount({ plugin: 'pager-view', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: PANE })
    expect(textOf(await desktop.drawn())).toContain('click a name to open its chat')
  })

  test('with no conversation the chats say so, under the live count', async ($, on) => {
    const w = world(on)
    w.who = `${w.who}kiwi  codex   /k         live  1m ago\n`
    await started($, w)
    const ui = await opened($, w)
    const text = textOf(await ui.drawn())

    expect(text).toContain(' wogi   ● 1 live')
    expect(text).toContain('No conversations yet.')
    expect(text).toContain('Messages wogi sends or receives show up here.')
    expect(text).not.toContain('kiwi')
  })

  test('unread is counted per room, lights its preview, clears when the room opens, and stays read while it is open', async ($, on) => {
    const w = world(on, { 'baseline:sid-a': 10 })
    w.messages = [MAIL(10), MAIL(11), { id: 12, to: 'wogi', from: 'lopu', fromSession: 'sid-l', body: 'hey' }]
    await started($, w)
    expect(await bandText($)).toBe('✉ wogi   2 new   ← lopu 48m  hey')

    const ui = await opened($, w)
    let text = textOf(await ui.drawn())
    expect(text).toContain(' · 2 unread')
    expect(await chips(ui, ' 1 ')).toHaveLength(2)
    const preview = (await ui.findAll({ type: 'Text' })).find(one => one.text === 'lopu: hey')
    expect(preview?.props.dimColor).toBe(false)

    await ui.press({ key: 'chat-buni' })
    await ui.press({ key: 'back' })
    text = textOf(await ui.drawn())
    expect(text).toContain(' · 1 unread')
    const read = (await ui.findAll({ type: 'Text' })).find(one => one.text === 'buni: mail 11')
    expect(read?.props.dimColor).toBe(true)
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
    w.messages = [{ id: 49, to: 'wogi', from: 'kiwi', fromSession: 'sid-k', body: 'yo' }, MAIL(50)]
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
    expect(text).toContain('yo')

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
    w.messages = [MAIL(50)]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    expect(textOf(await ui.drawn())).toContain('‹ chats')

    await w.clock.advance(WATCH)
    expect(textOf(await ui.drawn())).toContain('‹ chats')
  })

  test('a long root is cut from its start in the room header, keeping the folder at its end', async ($, on) => {
    const w = world(on)
    w.who = `${w.who}vuba  claude  /Users/u/Library/${'x'.repeat(80)}/scratch-end  live  1m ago\n`
    w.messages = [{ id: 51, to: 'wogi', from: 'vuba', fromSession: 'sid-v', body: 'hi' }]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-vuba' })
    const header = textOf(await ui.drawn())
      .split('\n')
      .find(line => line.startsWith('vuba  ● live · claude · …'))
    expect(header?.endsWith('xxx/scratch-end')).toBe(true)
  })

  test("the seen map is the store's: a reload under the same session keeps what each room read", async ($, on) => {
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
    w.messages = [{ id: 52, to: 'wogi', from: 'kiwi', fromSession: 'sid-k', body: 'hi' }]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-kiwi' })

    expect(textOf(await ui.drawn())).toContain('kiwi  ● live · codex · ~\\k')
  })
})

describe('room', () => {
  test('the room reads as a transcript: received runs under a ● line, sent ones beside the accent bar', async ($, on) => {
    const w = world(on)
    w.messages = [
      MAIL(30),
      { id: 31, to: 'buni', from: 'wogi', fromSession: 'sid-a', body: 'ack' },
      { id: 32, to: 'wogi', from: 'buni', fromSession: 'sid-buni', body: '대협 **확인** 부탁', human: true },
    ]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    const text = textOf(await ui.drawn())

    expect(text).toContain('‹ chats')
    expect(text).toContain('buni  ○ gone · codex · /other')
    expect(text).toMatch(new RegExp(`─ ${dayOf(isoOf(30))} ─`))
    expect(text.indexOf('mail 30')).toBeLessThan(text.indexOf('ack'))
    expect(text.indexOf('ack')).toBeLessThan(text.indexOf('대협 **확인** 부탁'))
    expect(text).toContain(`● buni  ${clockOf(isoOf(30))}`)
    expect(text).toContain(`you  ${clockOf(isoOf(31))}`)
    expect(text).toContain(`● buni  ${clockOf(isoOf(32))}  (human)`)
    // Bodies are Markdown, drawn as the transcript draws a reply.
    expect((await ui.findAll({ type: 'Markdown' })).map(one => one.props.text)).toEqual(['mail 30', 'ack', '대협 **확인** 부탁'])
    // The terminal bar is the engine's quote border; no message is boxed.
    expect((await ui.find({ key: 'run-31' }))?.props).toMatchObject({ borderStyle: 'quote', borderColor: 'claude' })
    expect((await ui.find({ key: 'run-30' }))?.props.borderStyle).toBeUndefined()
    expect((await boxes(ui)).filter(one => one.props.borderStyle === 'round')).toHaveLength(0)
    // The way back is at the bottom with its key; the header's is a plain control.
    expect((await ui.find({ key: 'back' }))?.props).toMatchObject({ hotkey: 'b', label: '‹ chats' })
    expect((await ui.find({ key: 'back-top' }))?.props.hotkey).toBeUndefined()
    expect(text.lastIndexOf('‹ chats')).toBeGreaterThan(text.indexOf('대협 **확인** 부탁'))

    // The desktop draws any borderStyle as a full box, so there the bar is a filled Box.
    const desktop = await $.ui.mount({ plugin: 'pager-view', surface: 'desktop', component: 'Pane', props: PANE_PROPS, requestId: PANE })
    const sent = (await desktop.find({ key: 'run-31' })) as Found | undefined
    expect(sent?.props.borderStyle).toBeUndefined()
    expect(sent?.children.some(child => (child as Found).props?.backgroundColor === 'claude')).toBe(true)
    const desk = textOf(await desktop.drawn())
    expect(desk).not.toContain('click ▾')
    expect(desk).not.toContain('scroll')
  })

  test('one side within ten minutes is one run: the sender line once, a time row for the next', async ($, on) => {
    const w = world(on)
    w.messages = [MAIL(20), MAIL(21), MAIL(45)]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    const text = textOf(await ui.drawn())

    expect(text.split('● buni').length - 1).toBe(2)
    expect(text).toContain(`● buni  ${clockOf(isoOf(20))}`)
    expect(text).toContain(`${clockOf(isoOf(21))}mail 21`)
    expect(text).toContain(`● buni  ${clockOf(isoOf(45))}`)
  })

  test('sent runs that follow one another share one bar, each under its own sender line', async ($, on) => {
    const w = world(on)
    const sent = (id: number): Message => ({ id, to: 'buni', from: 'wogi', fromSession: 'sid-a', body: `sent ${id}` })
    w.messages = [MAIL(10), sent(11), sent(40), MAIL(41)]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    const text = textOf(await ui.drawn())

    expect((await boxes(ui)).filter(one => one.props.borderStyle === 'quote')).toHaveLength(1)
    expect(text).toContain(`you  ${clockOf(isoOf(11))}`)
    expect(text).toContain(`you  ${clockOf(isoOf(40))}`)
    expect((await ui.find({ key: 'run-41' }))?.props.marginTop).toBe(0)
  })

  test('the room opens at its first unread under a new rule; what was unread is whole, older long ones fold', async ($, on) => {
    const w = world(on, { 'baseline:sid-a': 40, 'seen:sid-a': { buni: 40 } })
    const lines = (word: string) => Array.from({ length: 20 }, (_, i) => `${word} ${i + 1}`).join('\n')
    w.messages = [
      { ...MAIL(40), body: lines('old') },
      { ...MAIL(41), body: lines('unread') },
      { ...MAIL(42), body: lines('newest') },
    ]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    let text = textOf(await ui.drawn())

    expect(text).toContain('old 8…')
    expect(text).not.toContain('old 9')
    expect(text).toContain('▾ 12 more lines')
    expect(text).toContain('unread 20')
    expect(text).toContain('newest 20')
    // The rule sits between what was read and what was not, and the window opens on it.
    expect(text).toMatch(/─ new ─/)
    expect(text.indexOf(' new ')).toBeGreaterThan(text.indexOf('old 8'))
    expect(text.indexOf(' new ')).toBeLessThan(text.indexOf('unread 1'))
    // The window opens on it: `$.ui.scroll({ to: { key: 'new' } })`, which this kit build cannot
    // answer (no implementation for ui.scroll, and no op to hook), so the terminal capture checks it.
    expect(await ui.find({ key: 'new' })).toBeDefined()

    // Folding is the person's: one at a time, or all with `e`.
    await ui.press({ key: 'fold-41' })
    text = textOf(await ui.drawn())
    expect(text).not.toContain('unread 20')
    expect(text).toContain('unread 8…')
    expect(text).toContain('unfold all')
    await ui.press({ key: 'fold-all' })
    text = textOf(await ui.drawn())
    expect(text).toContain('old 20')
    expect(text).toContain('unread 20')
    expect(text).toContain('fold all')
    await ui.press({ key: 'fold-all' })
    text = textOf(await ui.drawn())
    expect(text).not.toContain('old 20')
    expect(text).not.toContain('newest 20')
    expect((await ui.find({ key: 'fold-all' }))?.props).toMatchObject({ hotkey: 'e' })

    // Back and in again: the rule is gone with the unread, and the newest alone is whole.
    await ui.press({ key: 'back' })
    await ui.press({ key: 'chat-buni' })
    text = textOf(await ui.drawn())
    expect(text).not.toMatch(/─ new ─/)
    expect(text).toContain('unread 8…')
    expect(text).toContain('newest 20')
  })

  test('when the first unread is past what the room draws, the new rule tops the first message drawn', async ($, on) => {
    const w = world(on, { 'baseline:sid-a': 40, 'seen:sid-a': { buni: 40 } })
    // Fifteen unread capped bodies, whole by default: 90,000 characters, past the 80,000 a room draws.
    w.messages = [MAIL(40), ...Array.from({ length: 15 }, (_, i) => ({ ...MAIL(41 + i), body: `u${41 + i} ${'x'.repeat(5_990)}` }))]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    const text = textOf(await ui.drawn())

    expect(text).toContain('3 earlier messages not shown')
    expect(text).not.toContain('u42 ')
    expect(text).toMatch(/─ new ─/)
    expect(text.indexOf(' new ')).toBeLessThan(text.indexOf('u43 '))
    expect(text.indexOf(' new ')).toBeGreaterThan(text.indexOf('earlier messages not shown'))
  })

  test('mail landing while the room is open stays whole after newer mail follows it', async ($, on) => {
    const w = world(on)
    w.messages = [MAIL(10)]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    w.messages.push({ ...MAIL(11), body: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') }, MAIL(12))
    await w.clock.advance(POLL)
    const text = textOf(await ui.drawn())

    expect(text).toContain('line 20')
    expect(text).toContain('mail 12')
  })

  test('a body past the cap names the rest when whole', async ($, on) => {
    const w = world(on)
    w.messages = [{ ...MAIL(41), body: 'ㄱ'.repeat(23_942) }]
    await started($, w)
    const ui = await opened($, w)
    await ui.press({ key: 'chat-buni' })
    let text = textOf(await ui.drawn())

    expect(text).toContain('ㄱ'.repeat(6_000))
    expect(text).not.toContain('ㄱ'.repeat(6_001))
    expect(text).toContain('… 17,942 more characters · full text: pager export (#41)')

    await ui.press({ key: 'fold-41' })
    text = textOf(await ui.drawn())
    expect(text).toMatch(/▾ \d+ more lines/)
    expect(text).not.toContain('more characters')
  })

  test('unfolding many long messages stays inside the drawing budget, the newest and the controls kept', async ($, on) => {
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
    // And `e` folds them all again, the hidden ones included: every message is back.
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
