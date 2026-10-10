// pm-band: the session's pm plan as one line above the prompt, and a /pm pane with
// its steps, the backlog and the backlog's dependency graph. Read-only: every
// fact comes from the pm CLIs; nothing here writes a plan, a task or a pointer.
//
// I/O happens in events and timers only; ui.render reads $.state and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, On, RenderElement, RenderInput } from 'claude-code'

import type { BacklogState, BandState, PlanView, Tab } from '../types'
import type { GraphProps } from './graph'
import {
  currentOf,
  graphOf,
  groupsOf,
  listingOf,
  planFile,
  resolvedOf,
  stepsOf,
} from './plan'
import type { Listing, Run } from './plan'

export const PANE = 'pm'
const REFRESH_DEBOUNCE_MS = 300
const DOTS_MAX = 20
// A row is cut at the pane edge anyway; the cap keeps a big backlog inside the
// engine's 100,000 characters of text per drawing.
const TITLE_CHARS = 200

const band = atom({ plugin: 'pm-band', key: 'band' } as const, {
  sessionId: '',
  view: null,
  error: null,
})
const backlog = atom({ plugin: 'pm-band', key: 'backlog' } as const, {
  sessionId: '',
  listing: null,
  error: null,
})
const tab = atom({ plugin: 'pm-band', key: 'tab' } as const, 'steps')
const selected = atom({ plugin: 'pm-band', key: 'selected' } as const, null)

type Paths = { resolver: string; tsx: string; pm: string }

async function pathsOf($: Engine): Promise<Paths> {
  // $.process.run takes argv, no shell: `~` would reach the child unexpanded.
  const home = (await $.env.get('HOME')) ?? ''
  const pm = `${home}/.config/ai/skills/pm-roadmap`
  return {
    resolver: `${home}/.config/ai/lib/worktree.mjs`,
    tsx: `${pm}/node_modules/.bin/tsx`,
    pm: `${pm}/pm-roadmap.ts`,
  }
}

async function run(
  $: Engine,
  argv: string[],
  init: { cwd?: string; env?: Record<string, string>; timeoutMs: number },
): Promise<Run> {
  try {
    return await $.process.run(argv, init)
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

// Module state: a reload starts it over, as it does $.clock timers.
// Bumped whenever the session id changes under the process (/clear, /resume,
// /branch): a refresh that started under an older generation is dropped.
let generation = 0
let isRefreshing = false
let isDirty = false
let pending: { cancel: () => void } | null = null

async function refreshOnce($: Engine): Promise<void> {
  const started = generation
  const sessionId = await $.session.id()
  const cwd = await $.session.cwd()
  const paths = await pathsOf($)
  const resolved = resolvedOf(
    await run($, ['node', paths.resolver, 'resolve-session', '--root', cwd, '--tool', 'claude'], {
      env: { PM_SESSION_TOOL: 'claude', PM_SESSION_ID: sessionId },
      timeoutMs: 10_000,
    }),
  )
  let view: PlanView | null = null
  let error: string | null = null
  // Every variant reports it, so the backlog is reachable from all of them —
  // a terminal plan and a resolver error included. See Resolved in plan.ts.
  const mainRoot = resolved.mainRoot
  if (resolved.kind === 'error') error = resolved.reason
  if (resolved.kind === 'none') {
    view = { kind: 'none' }
  }
  if (resolved.kind === 'plan') {
    try {
      const content = await $.fs.read(planFile(resolved.mainRoot, resolved.plan))
      view = {
        kind: 'plan',
        status: resolved.status,
        id: resolved.id,
        title: resolved.title,
        plan: resolved.plan,
        steps: stepsOf(content),
      }
    } catch (failure) {
      error = `plan unreadable: ${failure instanceof Error ? failure.message : String(failure)}`
    }
  }
  const isPaneOpen = (await $.ui.panes()).some(one => one.id === PANE)
  let listing: Listing | { error: string } | null = null
  if (isPaneOpen && mainRoot) {
    listing = listingOf(
      await run($, [paths.tsx, paths.pm, 'list', '--json', '--all'], {
        cwd: mainRoot,
        env: { PM_ROOT: mainRoot },
        timeoutMs: 15_000,
      }),
    )
  }
  if (started !== generation || sessionId !== (await $.session.id())) return
  await update($, band, (prev): BandState =>
    error === null
      ? { sessionId, view, error: null }
      : { sessionId, view: prev.sessionId === sessionId ? prev.view : null, error },
  )
  if (listing !== null) {
    const next = listing
    await update($, backlog, (prev): BacklogState =>
      'error' in next
        ? { sessionId, listing: prev.sessionId === sessionId ? prev.listing : null, error: next.error }
        : { sessionId, listing: next, error: null },
    )
  }
}

async function refresh($: Engine): Promise<void> {
  if (isRefreshing) {
    isDirty = true
    return
  }
  isRefreshing = true
  try {
    do {
      isDirty = false
      await refreshOnce($)
    } while (isDirty)
  } finally {
    isRefreshing = false
  }
}

function soon($: Engine): void {
  pending?.cancel()
  pending = $.clock.after(REFRESH_DEBOUNCE_MS, () => {
    pending = null
    void refresh($)
  })
}

/** /pm and the band's controls: open the pane (on `shown`, when given) and read the backlog. */
async function openPane($: Engine, shown?: Tab): Promise<void> {
  if (shown !== undefined) await update($, tab, () => shown)
  await $.ui.open({ id: PANE, title: 'pm', focus: true })
  soon($)
}

async function switched($: Engine): Promise<void> {
  generation += 1
  await update($, band, () => ({ sessionId: '', view: null, error: null }))
  await update($, backlog, () => ({ sessionId: '', listing: null, error: null }))
  await update($, selected, () => null)
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: 'Show the plan steps, the backlog and its dependency graph',
      immediate: true,
    })
    const result = await next(e)
    soon($)
    return result
  })

  // The hooks below only observe; if one fails, .catch hands back what next settled
  // to (or runs it once when it had not run), so a failure never blocks or repeats work.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    const result = await next(e)
    await switched($)
    soon($)
    return result
  }).catch(($, e, next) => next(e))

  on('classic.SessionEnd', async ($, e, next) => {
    generation += 1
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    soon($)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    soon($)
    return result
  })

  on('command.run', { command: PANE }, async $ => {
    await openPane($)
    return {}
  }).catch(($, e, next) => next(e))

  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data as { selected?: unknown } | null
    const id = typeof data?.selected === 'string' ? data.selected : null
    await update($, selected, () => id)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = await read($, band)
    const below = await next(e)
    const line = bandLine($, e, state)
    if (line === null) return below
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {line}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, band)
    const list = await read($, backlog)
    const shown = await read($, tab)
    const pick = await read($, selected)
    return paneOf($, e, { state, list, shown, pick })
  })
}

function bandLine($: Engine, e: RenderInput<'AbovePrompt'>, state: BandState): RenderElement | null {
  const { Text } = $.ui.resolve(e)
  const view = state.view
  if (state.error !== null && view === null) {
    return (
      <Text dimColor wrap="truncate-end">
        ⚠ plan: {state.error}
      </Text>
    )
  }
  if (view === null) return null
  if (view.kind === 'none') {
    return (
      <Text dimColor wrap="truncate-end">
        ○ no plan
      </Text>
    )
  }
  const done = view.steps.filter(step => step.isDone).length
  const current = currentOf(view.steps)
  const dots =
    view.steps.length > 0 && view.steps.length <= DOTS_MAX
      ? `${'●'.repeat(done)}${'○'.repeat(view.steps.length - done)} `
      : ''
  const { Box, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="row">
      <Box flexShrink={1}>
    <Text wrap="truncate-end">
      <Text color={view.status === 'active' ? 'warning' : 'inactive'}>
        {view.status === 'active' ? '▶' : '⚙'} {view.id}
      </Text>
      {'  '}
      <Text color="success">{dots}</Text>
      <Text dimColor>
        {done}/{view.steps.length}
      </Text>
      {current ? `  ${current.text}` : ''}
      {state.error !== null ? <Text dimColor> ⚠</Text> : ''}
    </Text>
      </Box>
      {/* The way into /pm from the band: each opens the pane on its tab. */}
      <Box flexDirection="row" flexShrink={0} columnGap={2} marginLeft={2}>
        <Button key="band-steps" label="steps" plain dimColor onPress={() => openPane($, 'steps')} />
        <Button key="band-graph" label="graph" plain dimColor onPress={() => openPane($, 'graph')} />
      </Box>
    </Box>
  )
}

const TABS: { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'steps', label: 'steps', hotkey: '1' },
  { tab: 'backlog', label: 'backlog', hotkey: '2' },
  { tab: 'graph', label: 'graph', hotkey: '3' },
]

function paneOf(
  $: Engine,
  e: RenderInput<'Pane'>,
  { state, list, shown, pick }: { state: BandState; list: BacklogState; shown: Tab; pick: string | null },
): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const tabs = (
    <Box flexDirection="row" columnGap={3}>
      {TABS.map(one => (
        <Button
          key={`tab-${one.tab}`}
          label={one.label}
          hotkey={one.hotkey}
          plain
          dimColor={one.tab !== shown}
          onPress={() => update($, tab, () => one.tab)}
        />
      ))}
    </Box>
  )
  const body =
    shown === 'steps'
      ? stepsBody($, e, state)
      : shown === 'backlog' || !hasClient(e)
        ? backlogBody($, e, list, state)
        : graphBody($, e, list, state, pick)
  return (
    <Box flexDirection="column">
      {tabs}
      {body}
    </Box>
  )
}

/** The graph is a Client; VS Code and mobile have none, so they get the list. */
function hasClient(e: RenderInput<'Pane'>): boolean {
  return e.surface === 'terminal' || e.surface === 'desktop'
}

function stepsBody($: Engine, e: RenderInput<'Pane'>, state: BandState): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const view = state.view
  if (view === null || view.kind === 'none') {
    return <Text dimColor>{state.error !== null ? `⚠ plan: ${state.error}` : 'No plan is bound to this session.'}</Text>
  }
  const done = view.steps.filter(step => step.isDone).length
  const current = currentOf(view.steps)
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold color="claude">
          {view.id}
        </Text>
        <Text dimColor>
          {' · '}
          {view.status} · {done}/{view.steps.length}
        </Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {view.title}
      </Text>
      <Text> </Text>
      {view.steps.map(step => (
        <Text
          wrap="truncate-end"
          dimColor={step.isDone}
          bold={step === current}
          color={step === current ? 'warning' : undefined}
        >
          {step.isDone ? '✓' : step === current ? '▶' : '○'} {step.n}. {step.text}
        </Text>
      ))}
    </Box>
  )
}

function currentPlanOf(state: BandState): string | undefined {
  return state.view?.kind === 'plan' ? state.view.plan : undefined
}

function backlogBody($: Engine, e: RenderInput<'Pane'>, list: BacklogState, state: BandState): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  if (list.listing === null) {
    return <Text dimColor>{list.error !== null ? `⚠ backlog: ${list.error}` : 'loading…'}</Text>
  }
  const groups = groupsOf(list.listing, currentPlanOf(state))
  if (groups.length === 0) return <Text dimColor>The backlog is empty.</Text>
  return (
    <Box flexDirection="column">
      {groups.map(group => (
        <Box flexDirection="column">
          <Text>
            <Text bold color="claude">
              {group.key}
            </Text>
            <Text dimColor> · {group.rows.length}</Text>
          </Text>
          {group.rows.map(row => (
            <Text wrap="truncate-end" bold={row.isCurrent} dimColor={row.isBlocked && !row.isCurrent}>
              {' '}
              {row.isCurrent ? '▶' : row.isBlocked ? '◌' : '·'} [{row.priority}] {row.id}
              <Text dimColor> — {row.title.length > TITLE_CHARS ? `${row.title.slice(0, TITLE_CHARS - 1)}…` : row.title}</Text>
              {row.blockedBy !== undefined ? (
                <Text color="warning">
                  {row.blockedByReason === 'order' ? `  ⤷ after ${row.blockedBy}` : `  ⤷ needs ${row.blockedBy}`}
                </Text>
              ) : (
                ''
              )}
            </Text>
          ))}
        </Box>
      ))}
      {list.listing.inbox > 0 ? <Text dimColor>inbox: {list.listing.inbox} awaiting triage</Text> : ''}
      {list.error !== null ? <Text dimColor>⚠ {list.error}</Text> : ''}
    </Box>
  )
}

/** The picked node's detail line: the item's task, priority, title and needs, or the task. */
function detailOf(list: BacklogState, pick: string | null): string | null {
  if (pick === null || list.listing === null) return null
  const chosen = [...list.listing.eligible, ...list.listing.blocked].find(item => item.id === pick)
  if (!chosen) return `task ${pick.replace(/^#/, '')}`
  const needs = chosen.dependsOn.length > 0 ? ` · needs ${chosen.dependsOn.join(', ')}` : ''
  return `${chosen.key}/${chosen.id} · [${chosen.priority}] ${chosen.title}${needs}`
}

function graphBody(
  $: Engine,
  e: RenderInput<'Pane'>,
  list: BacklogState,
  state: BandState,
  pick: string | null,
): RenderElement {
  const { Text } = $.ui.resolve(e)
  if (list.listing === null) {
    return <Text dimColor>{list.error !== null ? `⚠ backlog: ${list.error}` : 'loading…'}</Text>
  }
  const graph: GraphProps = graphOf(list.listing, currentPlanOf(state))
  const detail = detailOf(list, pick)
  const { Box, Client } = $.ui.resolve(e as RenderInput<'Pane'> & { surface: 'terminal' })
  const height = Math.max(5, e.props.scroll.bodyRows - 3)
  // The desktop sets text in a proportional face: the Client places each run at
  // its cell instead of drawing rows of spaced text (see graph.tsx).
  const props: GraphProps = e.surface === 'terminal' ? graph : { ...graph, isPlaced: true, rows: height }
  return (
    <Box flexDirection="column">
      <Client key="graph" module="./graph.tsx" props={props} width="100%" height={height} />
      <Text dimColor wrap="truncate-end">
        {detail ?? 'click a node · drag it to move · drag empty space or shift+arrows to pan · + − zoom · 0 fit'}
      </Text>
    </Box>
  )
}
