import type { Args, On, RenderElement, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Item, Listing } from '../types'
import { PANE } from './register'

const HOME = '/home/u'
const MAIN = '/work/main'
const PLAN_REL = '.agents/plans/2026-10-07-demo.md'
const PLAN_BODY = `---
id: demo
---
## Implementation Steps

- [x] 1. probe
- [x] 2. list --json
- [ ] 3. pm-band plan.ts
- [ ] 4. graph
`

const SESSION = { surface: 'terminal' as const, isInteractive: true, cwd: '/work/tree' }

const BAND: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 6 },
  view: {},
}

const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'pm',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const VIEWPORT = { columns: 160, rows: 40 }

const item = (over: Partial<Item> & Pick<Item, 'key' | 'id'>): Item => ({
  title: over.id,
  priority: 'P2',
  order: 0,
  plan: null,
  status: 'open',
  dependsOn: [],
  ...over,
})

const LISTING: Listing = {
  eligible: [
    item({ key: 'CFG', id: 'demo', title: 'The demo plan', plan: PLAN_REL }),
    item({ key: 'CFG', id: 'later', title: 'After the demo', priority: 'P3' }),
  ],
  blocked: [
    item({ key: 'CFG', id: 'needs-demo', dependsOn: ['demo'], blockedBy: 'demo', blockedByReason: 'dependency' }),
  ],
  inbox: 1,
}

type Resolver = { status: string; [key: string]: unknown }

const BOUND: Resolver = {
  status: 'ok',
  plan: PLAN_REL,
  plan_status: 'active',
  id: 'demo',
  title: 'Demo',
  main_root: MAIN,
}

/**
 * The world beneath pm-band, scripted per test: the session id, what the
 * resolver and `pm list --json` answer, the plan file, and which panes are open.
 */
function world(on: On, env: Record<string, string> = { HOME }) {
  const clock = mock.clock(on)
  mock.env(on, env)
  const w = {
    clock,
    sessionId: 'sid-a',
    resolver: (): Resolver | { fail: string } => BOUND,
    listing: (): Listing | { fail: string } => LISTING,
    plan: PLAN_BODY,
    panes: [] as string[],
    runs: [] as Args<'process.run'>[],
    reads: [] as string[],
    opened: [] as Args<'ui.open'>[],
    /** Set to hold the next resolver run until the test lets it go. */
    hold: null as null | Promise<void>,
    /** What the mods beneath pm-band draw in the band; nothing by default. */
    beneath: null as null | string,
  }
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return w.beneath === null ? Box({ children: [] }) : Text({ children: [w.beneath] })
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: w.sessionId }))
  on('session.cwd', () => ({ value: '/work/tree' }))
  on('ui.panes', () => ({
    value: w.panes.map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.open', ($, e) => {
    w.opened.push(e)
    if (!w.panes.includes(e.id)) w.panes.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('fs.read', ($, e) => {
    w.reads.push(String(e.path))
    return { value: w.plan }
  })
  on('process.run', async ($, e) => {
    w.runs.push(e)
    if (e.argv.includes('resolve-session')) {
      const held = w.hold
      const answer = w.resolver()
      if (held) await held
      if ('fail' in answer) return exited(1, '', String(answer.fail))
      return exited(0, JSON.stringify(answer))
    }
    if (e.argv.includes('list')) {
      const answer = w.listing()
      if ('fail' in answer) return exited(1, '', answer.fail)
      return exited(0, JSON.stringify(answer))
    }
    return exited(127, '', 'unexpected')
  })
  on('tool.call', () => ({ result: 'done' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  return w
}

const SETTLE = 400
/** How often pm-band looks at the session id. */
const WATCH = 1_000
const markersIn = (text: string) => (text.match(/[●◆◉]/g) ?? []).length

/** The `demo` node's label, and not `needs-demo`'s. */
const DEMO = /(?<![\w-])demo(?![\w-])/

function exited(exitCode: number, stdout: string, stderr = '') {
  return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
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

/** The graph Client's rows: its root Box holds one Text per grid row. */
function rowsOf(tree: unknown): string[] {
  const root = tree as { children?: unknown[] }
  return (root.children ?? []).map(textOf)
}

async function bandText($: Engine, props = BAND): Promise<string> {
  const tree = await $.ui.render({
    component: 'AbovePrompt',
    surface: 'terminal',
    requestId: 'band',
    props,
    viewport: VIEWPORT,
  })
  return textOf(tree as RenderElement).trim()
}

async function started($: Engine, w: ReturnType<typeof world>): Promise<void> {
  await $.session.start(SESSION)
  await w.clock.advance(SETTLE)
}

async function openPane($: Engine, w: ReturnType<typeof world>, isMeasured = true) {
  await $.command.run({
    command: PANE,
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  await w.clock.advance(SETTLE)
  return $.ui.mount({
    plugin: 'pm-band',
    surface: 'terminal',
    component: 'Pane',
    props: PANE_PROPS,
    requestId: PANE,
    ...(isMeasured ? { viewport: VIEWPORT } : {}),
  })
}

describe('register', () => {
  test('an active plan draws its id, progress and current step; the plan path joins main_root', async ($, on) => {
    const w = world(on)
    await started($, w)

    // Two of four done: two filled segments, the current one hollow in the warning color.
    expect(await bandText($)).toBe('▶ demo  ▰▰▱▱ 2/4  pm-band plan.ts\n\nstepsgraph')
    // The engine resolves fs paths for the host, including a Windows drive.
    expect(w.reads.map(path => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, ''))).toEqual([`${MAIN}/${PLAN_REL}`])
    const resolver = w.runs.find(r => r.argv.includes('resolve-session'))
    expect(resolver?.argv[1]).toBe(`${HOME}/.config/ai/lib/worktree.mjs`)
    expect(resolver?.init?.env).toEqual({ PM_SESSION_TOOL: 'claude', PM_SESSION_ID: 'sid-a' })
  })

  test('the band meter fills the done steps and marks the current one hollow in the warning color', async ($, on) => {
    const w = world(on)
    await started($, w)
    const band = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND,
      requestId: 'band',
      viewport: VIEWPORT,
    })
    const segments = (await band.findAll({ type: 'Text' })).filter(one => one.text === '▰' || one.text === '▱')

    expect(segments.map(one => [one.text, one.props.color, one.props.bold])).toEqual([
      ['▰', 'success', false],
      ['▰', 'success', false],
      ['▱', 'warning', true],
      ['▱', 'subtle', false],
    ])
  })

  test('without HOME the CLIs are found under USERPROFILE, as in the Windows desktop app', async ($, on) => {
    const w = world(on, { USERPROFILE: 'C:\\Users\\u' })
    await started($, w)

    const resolver = w.runs.find(r => r.argv.includes('resolve-session'))
    expect(resolver?.argv[1]).toBe('C:\\Users\\u/.config/ai/lib/worktree.mjs')
  })

  test('no plan draws a dim line, a terminal plan nothing, a failure a warning', async ($, on) => {
    const w = world(on)
    w.resolver = () => ({ status: 'unbound', main_root: MAIN })
    await started($, w)
    expect(await bandText($)).toBe('○ no plan')

    w.resolver = () => ({ status: 'terminal', plan_status: 'done' })
    await $.tool.call({ tool: 'Bash', command: 'true' })
    await w.clock.advance(SETTLE)
    expect(await bandText($)).toBe('')

    w.resolver = () => ({ fail: 'resolver crashed' })
    await $.tool.call({ tool: 'Bash', command: 'true' })
    await w.clock.advance(SETTLE)
    expect(await bandText($)).toBe('⚠ plan: resolver crashed')
  })

  test('a failed refresh keeps the last good line and marks it', async ($, on) => {
    const w = world(on)
    await started($, w)
    w.resolver = () => ({ fail: 'boom' })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
    await w.clock.advance(SETTLE)

    expect(await bandText($)).toBe('▶ demo  ▰▰▱▱ 2/4  pm-band plan.ts ⚠\n\nstepsgraph')
  })

  test('the band yields to a survey and keeps what the mods beneath draw', async ($, on) => {
    const w = world(on)
    w.beneath = '✉ wogi · 2 new'
    await started($, w)

    expect(await bandText($)).toBe('▶ demo  ▰▰▱▱ 2/4  pm-band plan.ts\n\nstepsgraph\n\n✉ wogi · 2 new')
    expect(await bandText($, { ...BAND, hasSurvey: true })).toBe('✉ wogi · 2 new')
  })

  test('requests during a refresh fold into one more run', async ($, on) => {
    const w = world(on)
    let release = () => {}
    w.hold = new Promise(resolve => {
      release = resolve
    })
    await $.session.start(SESSION)
    await w.clock.advance(SETTLE)
    for (let i = 0; i < 3; i++) {
      await $.tool.call({ tool: 'Bash', command: 'true' })
      await w.clock.advance(SETTLE)
    }
    w.hold = null
    release()
    await w.clock.advance(SETTLE)

    expect(w.runs.filter(r => r.argv.includes('resolve-session')).length).toBe(2)
  })

  test("a refresh still running when the session changes never lands in the new one", async ($, on) => {
    const w = world(on)
    await started($, w)
    let release = () => {}
    w.hold = new Promise(resolve => {
      release = resolve
    })
    await $.tool.call({ tool: 'Bash', command: 'true' })
    await w.clock.advance(SETTLE)

    // Only the id changes, with no event: the watch has to notice on its own.
    w.sessionId = 'sid-b'
    w.hold = null
    w.resolver = () => ({ fail: 'b is not readable yet' })
    await w.clock.advance(WATCH)
    // sid-a's view is gone, and sid-b's cannot land while sid-a's refresh is held.
    expect(await bandText($)).toBe('')
    release()
    await w.clock.settle()
    await w.clock.advance(SETTLE)

    expect(await bandText($)).toBe('⚠ plan: b is not readable yet')
  })

  test('/pm opens the pane, reads the backlog, and draws the steps tab', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await openPane($, w)

    expect(w.opened.map(o => o.id)).toEqual([PANE])
    const list = w.runs.find(r => r.argv.includes('list') && r.argv.includes('--json'))
    // node runs tsx's entry: Windows cannot start node_modules/.bin/tsx without a shell.
    expect(list?.argv.slice(0, 2)).toEqual(['node', `${HOME}/.config/ai/skills/pm-roadmap/node_modules/tsx/dist/cli.mjs`])
    const text = textOf(await ui.drawn())
    // The tab strip: the shown tab's segment of the rule is the heavy line (`1: steps` is 8 wide).
    expect(text).toContain(`stepsbackloggraph
${'━'.repeat(8)}${'─'.repeat(70)}
`)
    expect(text).toContain('demo   active ')
    expect(text).toContain('2/4 · 50%')
    // The gauge over the 78 columns the pane leaves: half filled.
    expect(text).toContain(`${'━'.repeat(39)}${'─'.repeat(39)}`)
    expect(text).toContain('✓ 1. probe')
    expect(text).toContain('NOW▶ 3. pm-band plan.ts')
    expect(text).toContain('○ 4. graph')
    // The key bar closes the view, after the last step.
    expect(text.indexOf('1 2 3 tabs · ↑↓ scroll')).toBeGreaterThan(text.lastIndexOf('○ 4. graph'))
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.find(one => one.text === ' active ')?.props).toMatchObject({ backgroundColor: 'success', color: 'inverseText' })
    const card = (await ui.findAll({ type: 'Box' })).find(box => box.props.borderStyle === 'round')
    expect(card?.props).toMatchObject({ borderColor: 'warning' })
    // The NOW card comes before the list, so a short pane still shows it.
    expect(text.indexOf('NOW▶ 3.')).toBeLessThan(text.indexOf('✓ 1. probe'))

    // Inline the blank rows go: the header follows the tab strip's rule, the card the gauge.
    await ui.unmount()
    const inline = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'terminal',
      component: 'Pane',
      props: { ...PANE_PROPS, placement: 'inline' },
      requestId: PANE,
      viewport: VIEWPORT,
    })
    const tight = textOf(await inline.drawn())
    expect(tight).toContain(`${'─'.repeat(70)}\ndemo   active `)
    expect(tight).toContain(`${'─'.repeat(39)}NOW`)
    expect(text).toContain(`${'─'.repeat(39)} NOW`)
  })

  test('outside a git repository the backlog and graph say so instead of loading forever', async ($, on) => {
    const w = world(on)
    w.resolver = () => ({ fail: 'fatal: not a git repository (or any of the parent directories): .git' })
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-backlog' })
    let text = textOf(await ui.drawn())
    expect(text).toContain('No pm backlog here.')
    expect(text).not.toContain('loading…')

    await ui.press({ key: 'tab-graph' })
    text = textOf(await ui.drawn())
    expect(text).toContain('No pm backlog here.')
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
  })

  test('a finished plan hides the band but its repository\'s backlog still lists', async ($, on) => {
    const w = world(on)
    w.resolver = () => ({ status: 'terminal', plan_status: 'done', main_root: MAIN })
    await started($, w)
    expect(await bandText($)).toBe('')
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-backlog' })

    expect(textOf(await ui.drawn())).toContain('needs-demo')
  })

  test('an empty backlog says so in both tabs, with the way to fill it, and draws no empty canvas', async ($, on) => {
    const w = world(on)
    w.listing = () => ({ eligible: [], blocked: [], inbox: 0 })
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-backlog' })
    let text = textOf(await ui.drawn())
    expect(text).toContain('The backlog is empty.')
    expect(text).toContain('/pm-roadmap')

    await ui.press({ key: 'tab-graph' })
    text = textOf(await ui.drawn())
    expect(text).toContain('The backlog is empty.')
    expect(await ui.find({ type: 'Client' })).toBeUndefined()

    w.resolver = () => ({ fail: 'resolver crashed' })
    await $.tool.call({ tool: 'Bash', command: 'true' })
    await w.clock.advance(SETTLE)
    await ui.press({ key: 'tab-backlog' })
    // A failed resolve keeps the last good listing and names the failure under it.
    text = textOf(await ui.drawn())
    expect(text).toContain('The backlog is empty.')
    expect(text).not.toContain('loading…')
  })

  test('off the terminal the tab strip is native Buttons, the shown one primary, with no rule', async ($, on) => {
    const w = world(on)
    await started($, w)
    const terminal = await openPane($, w)
    await terminal.unmount()
    const desktop = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'desktop',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: PANE,
      viewport: VIEWPORT,
    })

    expect((await desktop.find({ key: 'tab-steps' }))?.props).toMatchObject({ variant: 'primary' })
    expect((await desktop.find({ key: 'tab-backlog' }))?.props).toMatchObject({ variant: 'secondary' })
    // The labels are not followed by the terminal's rule (the gauge further down is its own),
    // and the native Buttons need no key bar.
    const drawn = textOf(await desktop.drawn())
    expect(drawn).not.toContain('stepsbackloggraph\n━')
    expect(drawn).not.toContain('1 2 3 tabs')
  })

  test('the backlog tab groups by task, names dependencies, and marks the current plan', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-backlog' })
    const text = textOf(await ui.drawn())

    expect(text).toContain(`${'─'.repeat(11)}${'━'.repeat(10)}─`)
    expect(text).toMatch(/CFG ─+ 3/)
    expect(text).toContain('▌  P2  demo  The demo plan')
    expect(text).toContain('◌  P2  needs-demo  ⤷ needs demo  needs-demo')
    expect(text).toContain('   P3  later  After the demo')
    expect(text).toContain('inbox · 1 awaiting triage')
    expect(text.indexOf('1 2 3 tabs · ↑↓ scroll')).toBeGreaterThan(text.indexOf('inbox · 1 awaiting triage'))
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.find(one => one.text === ' P2 ')?.props).toMatchObject({ bold: true })
    expect(texts.find(one => one.text === ' P3 ')?.props).toMatchObject({ dimColor: true })
    // The accent marks the current item alone: the bar is `claude`, a blocked mark is not.
    expect(texts.find(one => one.text === '▌')?.props).toMatchObject({ color: 'claude' })
    expect(texts.some(one => one.text === '◌' && one.props.color === 'claude')).toBe(false)
  })

  test('a terminal plan and a resolver error still read the backlog in the pane', async ($, on) => {
    // Closing a plan and opening /pm to pick the next item is the normal move,
    // and it resolves as terminal. The band goes quiet, but both pane tabs have
    // to show the backlog rather than wait on a plan that will never come.
    const w = world(on)
    w.resolver = () => ({ status: 'terminal', plan_status: 'done', main_root: MAIN })
    await started($, w)
    expect(await bandText($)).toBe('')

    const ui = await openPane($, w)
    await ui.press({ key: 'tab-backlog' })
    const text = textOf(await ui.drawn())
    expect(text).not.toContain('loading…')
    expect(text).toContain('◌  P2  needs-demo  ⤷ needs demo  needs-demo')
    expect(w.runs.some(r => r.argv.includes('list'))).toBe(true)

    // An error status reports a root too, so the backlog survives a bad binding
    // instead of the pane disagreeing with the warning the band shows.
    w.resolver = () => ({ status: 'missing_worktree', main_root: MAIN })
    await $.tool.call({ tool: 'Bash', command: 'true' })
    await w.clock.advance(SETTLE)
    expect(await bandText($)).toBe('⚠ plan: missing_worktree')
    expect(textOf(await ui.drawn())).not.toContain('loading…')
  })

  test('the graph tab mounts a Client that lays out, follows a drag, and reports a pick', async ($, on) => {
    const w = world(on)
    await started($, w)
    // Unmeasured, a Client starts at 0 by 0: it waits rather than laying out.
    const bare = await openPane($, w, false)
    await bare.press({ key: 'tab-graph' })
    expect(textOf(await bare.drawn({ in: 'graph' }))).toContain('loading…')
    // The line under the drawing is the graph's bar: no second one costs it rows.
    expect(textOf(await bare.drawn())).not.toContain('1 2 3 tabs')
    await bare.unmount()

    const ui = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'terminal',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: PANE,
      viewport: VIEWPORT,
    })

    await ui.resize({ columns: 60, rows: 12, in: 'graph' })
    await ui.advance(5_000)
    const settled = rowsOf(await ui.drawn({ in: 'graph' }))
    expect(settled.length).toBe(12)
    expect(settled.every(row => row.length === 60)).toBe(true)
    expect(settled.join('\n')).toContain('◆ CFG')
    expect(settled.join('\n')).toContain('● demo')
    await ui.advance(1_000)
    expect(rowsOf(await ui.drawn({ in: 'graph' }))).toEqual(settled)

    const y = settled.findIndex(row => row.includes('● demo'))
    const x = settled[y]!.indexOf('● demo')
    await ui.pointer({ type: 'down', x, y, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'move', x: 2, y: 0, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'up', x: 2, y: 0, button: 'left', in: 'graph' })
    await ui.advance(200)
    const dragged = rowsOf(await ui.drawn({ in: 'graph' }))
    expect(dragged[0]!.slice(2, 8)).toBe('◉ demo')

    expect(textOf(await ui.drawn())).toContain('CFG/demo · [P2] The demo plan')

    await ui.key({ key: 'right', in: 'graph' })
    expect(textOf(await ui.drawn())).not.toContain('CFG/demo · [P2] The demo plan')
  })

  test('a graph bigger than the region pans by dragging empty space or shift+arrows, zooms, and fits on 0', async ($, on) => {
    const w = world(on)
    w.resolver = () => ({ status: 'unbound', main_root: MAIN })
    w.listing = () => ({
      eligible: Array.from({ length: 40 }, (_, i) => item({ key: 'BIG', id: `n${i}` })),
      blocked: [],
      inbox: 0,
    })
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-graph' })
    await ui.resize({ columns: 60, rows: 12, in: 'graph' })
    await ui.advance(10_000)
    const shown = async () => rowsOf(await ui.drawn({ in: 'graph' })).join('\n')
    const markers = (text: string) => (text.match(/[●◆◉]/g) ?? []).length
    // Untouched, the camera fits the settled graph: every node is on screen.
    expect(markers(await shown())).toBe(41)
    // Zoomed in, only part of it is.
    for (let i = 0; i < 3; i++) await ui.key({ key: '+', in: 'graph' })
    await ui.advance(100)
    const first = await shown()
    expect(markers(first)).toBeLessThan(41)
    expect(markers(first)).toBeGreaterThan(0)

    // Drag from a cell no node covers: the camera moves, so the drawing moves.
    const rows = first.split('\n')
    let empty = { x: 0, y: 0 }
    search: for (let y = 0; y < rows.length; y++) {
      for (let x = 20; x < rows[y]!.length; x++) {
        if (!/[●◆◉]/.test(rows[y]!.slice(Math.max(0, x - 12), x + 2))) {
          empty = { x, y }
          break search
        }
      }
    }
    await ui.pointer({ type: 'down', ...empty, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'move', x: empty.x - 12, y: empty.y, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'up', x: empty.x - 12, y: empty.y, button: 'left', in: 'graph' })
    await ui.advance(100)
    const panned = await shown()
    expect(panned).not.toBe(first)

    await ui.key({ key: 'right', shift: true, in: 'graph' })
    await ui.advance(100)
    const before = await shown()
    expect(before).not.toBe(panned)

    // 0 fits every node: all 40 items and their hub are on screen.
    await ui.key({ key: '0', in: 'graph' })
    await ui.advance(100)
    const fitted = await shown()
    expect(markers(before)).toBeLessThan(41)
    expect(markers(fitted)).toBe(41)

    await ui.key({ key: '+', in: 'graph' })
    await ui.advance(100)
    expect(await shown()).not.toBe(fitted)
  })

  test('a node dragged past the edge of the first view stays out there, and 0 brings it back', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-graph' })
    await ui.resize({ columns: 60, rows: 12, in: 'graph' })
    await ui.advance(5_000)
    const shown = async () => rowsOf(await ui.drawn({ in: 'graph' }))
    const rows = await shown()
    const y = rows.findIndex(row => row.includes('● demo'))
    const x = rows[y]!.indexOf('● demo')
    // The pointer is held past the region's left edge: the node goes with it.
    await ui.pointer({ type: 'down', x, y, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'move', x: -20, y: 5, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'up', x: -20, y: 5, button: 'left', in: 'graph' })
    await ui.advance(2_000)
    expect((await shown()).join('\n')).not.toMatch(DEMO)

    // As a person does: click the drawing (an empty cell) to give it the keys.
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'graph' })
    await ui.key({ key: '0', in: 'graph' })
    await ui.advance(100)
    // Fitted far out, labels may be cut; every node's marker is drawn.
    expect(markersIn((await shown()).join('\n'))).toBe(4)
  })

  test('a node dragged out to the right stays out through a resize', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-graph' })
    await ui.resize({ columns: 60, rows: 12, in: 'graph' })
    await ui.advance(5_000)
    const shown = async () => rowsOf(await ui.drawn({ in: 'graph' })).join('\n')
    const rows = rowsOf(await ui.drawn({ in: 'graph' }))
    const y = rows.findIndex(row => row.includes('● demo'))
    const x = rows[y]!.indexOf('● demo')
    await ui.pointer({ type: 'down', x, y, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'move', x: 90, y: 5, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'up', x: 90, y: 5, button: 'left', in: 'graph' })
    await ui.advance(2_000)
    expect(await shown()).not.toMatch(DEMO)

    // The region narrows and widens again: the world must not squeeze the
    // dragged node back into view.
    await ui.resize({ columns: 50, rows: 12, in: 'graph' })
    await ui.advance(2_000)
    expect(await shown()).not.toMatch(DEMO)
    await ui.resize({ columns: 60, rows: 12, in: 'graph' })
    await ui.advance(2_000)
    expect(await shown()).not.toMatch(DEMO)

    // As a person does: click the drawing (an empty cell) to give it the keys.
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'graph' })
    await ui.key({ key: '0', in: 'graph' })
    await ui.advance(100)
    expect(markersIn(await shown())).toBe(4)
  })

  test('new props keep placed nodes, add new ones, drop gone ones, and start the layout again', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-graph' })
    await ui.resize({ columns: 60, rows: 12, in: 'graph' })
    await ui.advance(5_000)
    const before = rowsOf(await ui.drawn({ in: 'graph' })).join('\n')

    w.listing = () => ({
      ...LISTING,
      eligible: [LISTING.eligible[0]!, item({ key: 'CFG', id: 'fresh' })],
    })
    await $.tool.call({ tool: 'Bash', command: 'true' })
    await w.clock.advance(SETTLE)
    const moving = rowsOf(await ui.drawn({ in: 'graph' })).join('\n')
    expect(moving).toContain('● fresh')
    expect(moving).not.toContain('later')
    await ui.advance(5_000)
    const after = rowsOf(await ui.drawn({ in: 'graph' })).join('\n')
    expect(after).not.toBe(before)
    expect(after).toContain('● demo')
  })

  test('a big backlog stays inside the cap, and a surface without Client gets the list', async ($, on) => {
    const w = world(on)
    w.resolver = () => ({ status: 'unbound', main_root: MAIN })
    w.listing = () => ({
      eligible: Array.from({ length: 300 }, (_, i) => item({ key: 'BIG', id: `big-${i}`, title: 'x'.repeat(5000) })),
      blocked: [],
      inbox: 0,
    })
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-graph' })
    await ui.resize({ columns: 100, rows: 30, in: 'graph' })
    await ui.advance(5_000)
    expect(textOf(await ui.drawn({ in: 'graph' }))).toMatch(/\+\d+ more/)

    const vscode = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'vscode',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: PANE,
      viewport: VIEWPORT,
    })
    await vscode.press({ key: 'tab-graph' })
    expect(textOf(await vscode.drawn())).toContain('BIG')
    expect(await vscode.find({ type: 'Client' })).toBeUndefined()
    // Titles are cut at 200 characters, so 300 long ones stay a drawable list.
    const list = textOf(await vscode.drawn())
    expect(list).toContain(`${'x'.repeat(199)}…`)
    expect(list).not.toContain('x'.repeat(200))
  })

  test('the desktop places every run at its cell, and a click or hover there hits the node', async ($, on) => {
    const w = world(on)
    await started($, w)
    await openPane($, w)
    const ui = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'desktop',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: PANE,
      viewport: VIEWPORT,
    })
    await ui.press({ key: 'tab-graph' })
    // The desktop sizes the region to what is drawn: it reports the one row of
    // `loading…`. The layout must still use the rows the hooks asked for
    // (bodyRows 20 − 3), or every node lands on one line.
    await ui.resize({ columns: 60, rows: 1, in: 'graph' })
    await ui.advance(5_000)
    const drawn = (await ui.drawn({ in: 'graph' })) as { children?: unknown[] }
    // One Box sized to the rows asked for, holding one absolute Box per run of glyphs.
    const field = drawn.children?.[0] as { props?: Record<string, unknown>; children?: unknown[] }
    expect(field.props).toMatchObject({ position: 'relative', width: 60, height: 17 })
    const runs = (field.children ?? []) as { props?: { position?: string; left?: number; top?: number }; children?: unknown[] }[]
    expect(runs.length).toBeGreaterThan(3)
    expect(runs.every(run => run.props?.position === 'absolute')).toBe(true)
    expect(new Set(runs.map(run => run.props?.top)).size).toBeGreaterThan(2)
    const demo = runs.find(run => textOf(run).startsWith('● demo'))!
    expect(demo).toBeDefined()
    const x = demo.props!.left!
    const y = demo.props!.top!

    await ui.pointer({ type: 'move', x: x + 3, y, in: 'graph' })
    await ui.advance(100)
    const hovered = ((await ui.drawn({ in: 'graph' })) as { children?: unknown[] }).children?.[0] as { children?: unknown[] }
    const hit = (hovered.children ?? []).find(run => textOf(run).startsWith('● demo')) as { children?: { props?: Record<string, unknown> }[] }
    expect(hit.children?.[0]?.props).toMatchObject({ underline: true })

    await ui.pointer({ type: 'leave', x: x + 3, y, in: 'graph' })
    await ui.advance(100)
    const left = ((await ui.drawn({ in: 'graph' })) as { children?: unknown[] }).children?.[0] as { children?: unknown[] }
    const rested = (left.children ?? []).find(run => textOf(run).startsWith('● demo')) as { children?: { props?: Record<string, unknown> }[] }
    expect(rested.children?.[0]?.props?.underline).toBeUndefined()

    await ui.pointer({ type: 'down', x, y, button: 'left', in: 'graph' })
    await ui.pointer({ type: 'up', x, y, button: 'left', in: 'graph' })
    await ui.advance(100)
    expect(textOf(await ui.drawn())).toContain('CFG/demo · [P2] The demo plan')

    const mobile = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'mobile',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: PANE,
      viewport: VIEWPORT,
    })
    await mobile.press({ key: 'tab-graph' })
    expect(textOf(await mobile.drawn())).toContain('▌  P2  demo')
  })

  test("the band's steps and graph controls open /pm on that tab", async ($, on) => {
    const w = world(on)
    await started($, w)
    const band = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND,
      requestId: 'band',
      viewport: VIEWPORT,
    })
    await band.press({ key: 'band-graph' })
    expect(w.opened.at(-1)).toMatchObject({ id: PANE, focus: true })
    await w.clock.advance(SETTLE)
    const pane = await $.ui.mount({
      plugin: 'pm-band',
      surface: 'terminal',
      component: 'Pane',
      props: PANE_PROPS,
      requestId: PANE,
      viewport: VIEWPORT,
    })
    expect(await pane.find({ type: 'Client' })).toBeDefined()
    await band.press({ key: 'band-steps' })
    expect(textOf(await pane.drawn())).toContain('▶ 3. pm-band plan.ts')
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
