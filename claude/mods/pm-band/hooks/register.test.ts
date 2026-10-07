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
function world(on: On) {
  const clock = mock.clock(on)
  mock.env(on, { HOME })
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
  on('classic.SessionStart', () => ({}))
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

    expect(await bandText($)).toBe('▶ demo  ●●○○ 2/4  pm-band plan.ts\nstepsgraph')
    expect(w.reads).toEqual([`${MAIN}/${PLAN_REL}`])
    const resolver = w.runs.find(r => r.argv.includes('resolve-session'))
    expect(resolver?.argv[1]).toBe(`${HOME}/.config/ai/lib/worktree.mjs`)
    expect(resolver?.init?.env).toEqual({ PM_SESSION_TOOL: 'claude', PM_SESSION_ID: 'sid-a' })
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

    expect(await bandText($)).toBe('▶ demo  ●●○○ 2/4  pm-band plan.ts ⚠\nstepsgraph')
  })

  test('the band yields to a survey and keeps what the mods beneath draw', async ($, on) => {
    const w = world(on)
    w.beneath = '✉ wogi · 2 new'
    await started($, w)

    expect(await bandText($)).toBe('▶ demo  ●●○○ 2/4  pm-band plan.ts\nstepsgraph\n\n✉ wogi · 2 new')
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

    w.sessionId = 'sid-b'
    w.hold = null
    w.resolver = () => ({ fail: 'b is not readable yet' })
    await $.classic.SessionStart({ source: 'clear' })
    release()
    // Before sid-b's own refresh runs: sid-a's late result must not have landed.
    await w.clock.settle()
    expect(await bandText($)).toBe('')
    await w.clock.advance(SETTLE)

    expect(await bandText($)).toBe('⚠ plan: b is not readable yet')
  })

  test('/pm opens the pane, reads the backlog, and draws the steps tab', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await openPane($, w)

    expect(w.opened.map(o => o.id)).toEqual([PANE])
    expect(w.runs.some(r => r.argv.includes('list') && r.argv.includes('--json'))).toBe(true)
    const text = textOf(await ui.drawn())
    expect(text).toContain('demo · active · 2/4')
    expect(text).toContain('✓ 1. probe')
    expect(text).toContain('▶ 3. pm-band plan.ts')
    expect(text).toContain('○ 4. graph')
  })

  test('the backlog tab groups by task, names dependencies, and marks the current plan', async ($, on) => {
    const w = world(on)
    await started($, w)
    const ui = await openPane($, w)
    await ui.press({ key: 'tab-backlog' })
    const text = textOf(await ui.drawn())

    expect(text).toContain('CFG')
    expect(text).toContain('▶ [P2] demo — The demo plan')
    expect(text).toContain('◌ [P2] needs-demo — needs-demo  ⤷ needs demo')
    expect(text).toContain('inbox: 1 awaiting triage')
  })

  test('the graph tab mounts a Client that lays out, follows a drag, and reports a pick', async ($, on) => {
    const w = world(on)
    await started($, w)
    // Unmeasured, a Client starts at 0 by 0: it waits rather than laying out.
    const bare = await openPane($, w, false)
    await bare.press({ key: 'tab-graph' })
    expect(textOf(await bare.drawn({ in: 'graph' }))).toContain('loading…')
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
    const svg = await vscode.find({ type: 'Svg' })
    expect(String(svg?.props?.source ?? '').length).toBeLessThan(131_072)
    expect(textOf(await vscode.drawn())).toMatch(/\+\d+ more not drawn/)
  })

  test('desktop, vscode and mobile draw the graph as an Svg with a node list; a press shows the detail', async ($, on) => {
    const w = world(on)
    await started($, w)
    await openPane($, w)
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({
        plugin: 'pm-band',
        surface,
        component: 'Pane',
        props: PANE_PROPS,
        requestId: PANE,
        viewport: VIEWPORT,
      })
      await ui.press({ key: 'tab-graph' })
      const svg = await ui.find({ type: 'Svg' })
      expect(String(svg?.props?.alt)).toBe('Backlog graph: 1 task, 3 items, 1 dependency link')
      expect(String(svg?.props?.source)).toContain('<title>demo — The demo plan</title>')
      expect(await ui.find({ type: 'Client' })).toBeUndefined()
      expect(await ui.find({ key: 'node-later' })).toBeDefined()
      expect(textOf(await ui.drawn())).toContain('pick a node below the drawing')
      await ui.press({ key: 'node-demo' })
      expect(textOf(await ui.drawn())).toContain('CFG/demo · [P2] The demo plan')
      expect(String((await ui.find({ type: 'Svg' }))?.props?.source)).toContain('class="label picked"')
      await ui.press({ key: 'node-demo' })
      expect(textOf(await ui.drawn())).toContain('pick a node below the drawing')
      await ui.unmount()
    }
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
