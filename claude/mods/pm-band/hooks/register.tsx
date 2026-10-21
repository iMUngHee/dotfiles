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
  gaugeOf,
  graphOf,
  groupsOf,
  listingOf,
  meterOf,
  planFile,
  resolvedOf,
  stepsOf,
} from './plan'
import type { Listing, Run } from './plan'

export const PANE = 'pm'
const REFRESH_DEBOUNCE_MS = 300
// How often the session id is compared; see watchSession.
const SESSION_WATCH_MS = 1_000
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
  isOutside: false,
})
const tab = atom({ plugin: 'pm-band', key: 'tab' } as const, 'steps')
const selected = atom({ plugin: 'pm-band', key: 'selected' } as const, null)

type Paths = { resolver: string; tsx: string; pm: string }

async function pathsOf($: Engine): Promise<Paths> {
  // $.process.run takes argv, no shell: `~` would reach the child unexpanded.
  // Windows: HOME is only set by a shell profile, so a session started without one
  // (the desktop app) has USERPROFILE alone.
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const pm = `${home}/.config/ai/skills/pm-roadmap`
  return {
    resolver: `${home}/.config/ai/lib/worktree.mjs`,
    // tsx's own entry run by node, not node_modules/.bin/tsx: on Windows that is a
    // shell script and its .cmd twin, and neither starts without a shell.
    tsx: `${pm}/node_modules/tsx/dist/cli.mjs`,
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
// The id watchSession last saw.
let sessionSeen = ''

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
  // `outside`: no repository, so no backlog: said at once rather than left `loading…`.
  let listing: Listing | { error: string } | 'outside' | null = null
  if (isPaneOpen && !mainRoot) listing = resolved.kind === 'error' ? { error: resolved.reason } : 'outside'
  if (isPaneOpen && mainRoot) {
    listing = listingOf(
      await run($, ['node', paths.tsx, paths.pm, 'list', '--json', '--all'], {
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
      next === 'outside'
        ? { sessionId, listing: null, error: null, isOutside: true }
        : 'error' in next
          ? { sessionId, listing: prev.sessionId === sessionId ? prev.listing : null, error: next.error, isOutside: false }
          : { sessionId, listing: next, error: null, isOutside: false },
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
  await update($, backlog, () => ({ sessionId: '', listing: null, error: null, isOutside: false }))
  await update($, selected, () => null)
}

// /clear, /resume and /branch change the id under the process. classic.SessionStart
// said so for all three, but on a machine with managed settings (and in Team and
// Enterprise organizations) the built-in cc-plugin-sec-default runs outermost and
// sends every classic.* event past the plugins a person installs
// (next.to(e, "append")): a classic hook here never runs, and the engine reports
// it as skipped. session.end still fires for /clear and resume, but before the id
// changes and never for /branch. So the id is compared on a timer.
async function watchSession($: Engine): Promise<void> {
  const sessionId = await $.session.id()
  if (sessionId === sessionSeen) return
  sessionSeen = sessionId
  await switched($)
  soon($)
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: 'Show the plan steps, the backlog and its dependency graph',
      immediate: true,
    })
    const result = await next(e)
    sessionSeen = await $.session.id()
    $.clock.every(SESSION_WATCH_MS, () => void watchSession($))
    soon($)
    return result
  })

  // The hooks below only observe; if one fails, .catch hands back what next settled
  // to (or runs it once when it had not run), so a failure never blocks or repeats work.
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
  const { Box, Text, Button } = $.ui.resolve(e)
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
  const meter = meterOf(view.steps)
  return (
    <Box flexDirection="row">
      <Box flexShrink={1}>
        <Text wrap="truncate-end">
          <Text color={view.status === 'active' ? 'warning' : 'inactive'}>{view.status === 'active' ? '▶' : '⚙'}</Text>{' '}
          <Text bold color="claude">
            {view.id}
          </Text>
          {'  '}
          {/* The current step is hollow like the steps ahead, so the filled ones count what is done. */}
          {meter.map(segment => (
            <Text
              color={segment === 'done' ? 'success' : segment === 'current' ? 'warning' : 'subtle'}
              bold={segment === 'current'}
            >
              {segment === 'done' ? '▰' : '▱'}
            </Text>
          ))}
          {meter.length > 0 ? ' ' : ''}
          <Text dimColor>
            {done}/{view.steps.length}
          </Text>
          {current ? `  ${current.text}` : ''}
          {state.error !== null ? <Text dimColor> ⚠</Text> : ''}
        </Text>
      </Box>
      <Box flexGrow={1} />
      {/* The way into /pm from the band, pinned to its right edge: each opens the pane on its tab. */}
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
const TAB_GAP = 3

function paneOf(
  $: Engine,
  e: RenderInput<'Pane'>,
  { state, list, shown, pick }: { state: BandState; list: BacklogState; shown: Tab; pick: string | null },
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  // The pane frame is the engine's; the content keeps a column clear on each side.
  const width = Math.max(20, e.props.bodyColumns - 2)
  const isGraph = shown === 'graph' && hasClient(e)
  // Seated inline above the prompt the pane shows about eleven rows: spacing goes first.
  const isTight = e.props.placement === 'inline'
  const body =
    shown === 'steps'
      ? stepsBody($, e, state, width, isTight)
      : isGraph
        ? graphBody($, e, list, state, pick)
        : backlogBody($, e, list, state, width)
  return (
    <Box flexDirection="column" paddingX={1}>
      {tabStrip($, e, shown, width)}
      {/* The drawing keeps the row: its own margins already part it from the tabs. */}
      {isGraph || isTight ? '' : <Text> </Text>}
      {body}
      {/* Steps and backlog have no keys of their own, so their bar names the tabs' and the
          scroll's; the graph's line under the drawing is its bar. Text, not Buttons: the
          tab strip already holds the digit hotkeys, and a second holder would clash. */}
      {isGraph || e.surface !== 'terminal' ? (
        ''
      ) : (
        <Box marginTop={1}>
          <Text dimColor wrap="truncate-end">
            1 2 3 tabs · ↑↓ scroll
          </Text>
        </Box>
      )}
    </Box>
  )
}

/**
 * The tabs. On the terminal, plain hotkey Buttons over a rule whose segment under
 * the shown tab is the accent's heavy line; elsewhere Buttons are native, so the
 * shown one is the primary instead.
 */
function tabStrip($: Engine, e: RenderInput<'Pane'>, shown: Tab, width: number): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const pressed = (one: Tab) => () => update($, tab, () => one)
  if (e.surface !== 'terminal') {
    return (
      <Box flexDirection="row" columnGap={1}>
        {TABS.map(one => (
          <Button
            key={`tab-${one.tab}`}
            label={one.label}
            hotkey={one.hotkey}
            variant={one.tab === shown ? 'primary' : 'secondary'}
            onPress={pressed(one.tab)}
          />
        ))}
      </Box>
    )
  }
  // A plain Button draws `1: steps`, so that is how wide its segment of the rule is.
  const widths = TABS.map(one => `${one.hotkey}: ${one.label}`.length)
  const used = widths.reduce((sum, one) => sum + one, 0) + TAB_GAP * (TABS.length - 1)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={TAB_GAP}>
        {TABS.map(one => (
          <Button
            key={`tab-${one.tab}`}
            label={one.label}
            hotkey={one.hotkey}
            plain
            dimColor={one.tab !== shown}
            onPress={pressed(one.tab)}
          />
        ))}
      </Box>
      <Text wrap="truncate-end">
        {TABS.map((one, index) => (
          <Text>
            <Text color={one.tab === shown ? 'claude' : 'subtle'}>{(one.tab === shown ? '━' : '─').repeat(widths[index]!)}</Text>
            {index < TABS.length - 1 ? <Text color="subtle">{'─'.repeat(TAB_GAP)}</Text> : ''}
          </Text>
        ))}
        <Text color="subtle">{'─'.repeat(Math.max(0, width - used))}</Text>
      </Text>
    </Box>
  )
}

/** The graph is a Client; VS Code and mobile have none, so they get the list. */
function hasClient(e: RenderInput<'Pane'>): boolean {
  return e.surface === 'terminal' || e.surface === 'desktop'
}

function stepsBody(
  $: Engine,
  e: RenderInput<'Pane'>,
  state: BandState,
  width: number,
  isTight: boolean,
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const view = state.view
  if (view === null || view.kind === 'none') {
    return <Text dimColor>{state.error !== null ? `⚠ plan: ${state.error}` : 'No plan is bound to this session.'}</Text>
  }
  const done = view.steps.filter(step => step.isDone).length
  const current = currentOf(view.steps)
  const gauge = gaugeOf(done, view.steps.length, width)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            <Text bold color="claude">
              {view.id}
            </Text>
            {'  '}
            <Text backgroundColor={view.status === 'active' ? 'success' : 'inactive'} color="inverseText" bold>
              {` ${view.status} `}
            </Text>
          </Text>
        </Box>
        <Box flexGrow={1} />
        <Box flexShrink={0} marginLeft={2}>
          <Text dimColor>
            {done}/{view.steps.length} · {gauge.pct}%
          </Text>
        </Box>
      </Box>
      <Text dimColor wrap="truncate-end">
        {view.title}
      </Text>
      <Text wrap="truncate-end">
        <Text color="success">{'━'.repeat(gauge.filled)}</Text>
        <Text color="subtle">{'─'.repeat(gauge.rest)}</Text>
      </Text>
      {isTight ? '' : <Text> </Text>}
      {current ? (
        // The one focal card, above the list: an inline pane shows about eleven rows,
        // and the step being worked on has to be among them, whole.
        <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
          <Text dimColor bold>
            NOW
          </Text>
          <Text wrap="wrap" bold color="warning">
            ▶ {current.n}. {current.text}
          </Text>
        </Box>
      ) : (
        ''
      )}
      {view.steps.map(step => (
        <Box paddingLeft={2}>
          <Text
            wrap="truncate-end"
            dimColor={step.isDone}
            bold={step === current}
            color={step === current ? 'warning' : undefined}
          >
            <Text color={step.isDone ? 'success' : undefined}>{step.isDone ? '✓' : step === current ? '▶' : '○'}</Text>{' '}
            {step.n}. {step.text}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

function currentPlanOf(state: BandState): string | undefined {
  return state.view?.kind === 'plan' ? state.view.plan : undefined
}

/** A tab with nothing to list: what is missing in bold, and what would fill it, dim. */
function emptyOf($: Engine, e: RenderInput<'Pane'>, title: string, hint: string): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Text dimColor wrap="wrap">
        {hint}
      </Text>
    </Box>
  )
}

const EMPTY_HINT = 'Items show up here once pm adds them (/pm-roadmap); untriaged ones wait in the inbox.'

/** The backlog and graph tabs before or without a listing: outside a repository, failed, or still reading. */
function unlistedOf($: Engine, e: RenderInput<'Pane'>, list: BacklogState): RenderElement {
  const { Text } = $.ui.resolve(e)
  if (list.isOutside) {
    return emptyOf($, e, 'No pm backlog here.', '/pm reads the backlog of the git repository this session runs in; this one runs outside any.')
  }
  if (list.error !== null) return <Text dimColor>⚠ backlog: {list.error}</Text>
  return <Text dimColor>loading…</Text>
}

function backlogBody(
  $: Engine,
  e: RenderInput<'Pane'>,
  list: BacklogState,
  state: BandState,
  width: number,
): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  if (list.listing === null) {
    return unlistedOf($, e, list)
  }
  const groups = groupsOf(list.listing, currentPlanOf(state))
  if (groups.length === 0) {
    return (
      <Box flexDirection="column">
        {emptyOf($, e, 'The backlog is empty.', EMPTY_HINT)}
        {list.listing.inbox > 0 ? <Text dimColor>inbox · {list.listing.inbox} awaiting triage</Text> : ''}
      </Box>
    )
  }
  // P0 and P1 stand out on the warning fill; P2 is the plain middle; the rest step back.
  const chipOf = (priority: string) =>
    /^P[01]$/.test(priority) ? (
      <Text backgroundColor="warning" color="inverseText" bold>{` ${priority} `}</Text>
    ) : priority === 'P2' ? (
      <Text bold>{` ${priority} `}</Text>
    ) : (
      <Text dimColor>{` ${priority} `}</Text>
    )
  return (
    <Box flexDirection="column">
      {groups.map((group, index) => {
        const count = String(group.rows.length)
        return (
          <Box flexDirection="column" marginTop={index === 0 ? 0 : 1}>
            <Text wrap="truncate-end">
              <Text bold color="claude">
                {group.key}
              </Text>
              <Text color="subtle">{` ${'─'.repeat(Math.max(2, width - group.key.length - count.length - 2))} `}</Text>
              <Text dimColor>{count}</Text>
            </Text>
            {group.rows.map(row => (
              <Text wrap="truncate-end" dimColor={row.isBlocked && !row.isCurrent}>
                {/* The accent is the cursor's alone; a blocked mark stays as dim as its row. */}
                {row.isCurrent ? <Text color="claude">▌</Text> : row.isBlocked ? '◌' : ' '}{' '}
                {chipOf(row.priority)}{' '}
                <Text bold={row.isCurrent}>{row.id}</Text>
                {/* What blocks the item before its title: the row is cut at the edge, and the
                    reason is the short, telling part. */}
                {row.blockedBy !== undefined ? (
                  <Text color="warning">
                    {row.blockedByReason === 'order' ? `  ⤷ after ${row.blockedBy}` : `  ⤷ needs ${row.blockedBy}`}
                  </Text>
                ) : (
                  ''
                )}
                <Text dimColor>
                  {'  '}
                  {row.title.length > TITLE_CHARS ? `${row.title.slice(0, TITLE_CHARS - 1)}…` : row.title}
                </Text>
              </Text>
            ))}
          </Box>
        )
      })}
      {list.listing.inbox > 0 ? (
        <Box marginTop={1}>
          <Text dimColor>inbox · {list.listing.inbox} awaiting triage</Text>
        </Box>
      ) : (
        ''
      )}
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
    return unlistedOf($, e, list)
  }
  const graph: GraphProps = graphOf(list.listing, currentPlanOf(state))
  // Nothing to draw: say so in words, not with an empty canvas.
  if (graph.nodes.length === 0) return emptyOf($, e, 'The backlog is empty.', EMPTY_HINT)
  const detail = detailOf(list, pick)
  const { Box, Client } = $.ui.resolve(e as RenderInput<'Pane'> & { surface: 'terminal' })
  // What the tab strip and the line under the drawing leave of the body.
  const height = Math.max(5, e.props.scroll.bodyRows - 3)
  // The desktop sets text in a proportional face: the Client places each run at
  // its cell instead of drawing rows of spaced text (see graph.tsx).
  const props: GraphProps = e.surface === 'terminal' ? graph : { ...graph, isPlaced: true, rows: height }
  return (
    <Box flexDirection="column">
      <Client key="graph" module="./graph.tsx" props={props} width="100%" height={height} />
      {detail !== null ? (
        <Text wrap="truncate-end">
          <Text color="claude">◆ </Text>
          <Text bold>{detail}</Text>
        </Text>
      ) : (
        <Text dimColor wrap="truncate-end">
          click a node · drag it to move · drag empty space or shift+arrows to pan · + − zoom · 0 fit
        </Text>
      )}
    </Box>
  )
}
