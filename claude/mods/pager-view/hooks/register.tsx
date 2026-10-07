// pager-view: this session's pager name and its new mail as one line above the
// prompt, and a /pager pane with the session's conversation and its peers.
// Read-only: it lists and exports; it never sends, marks or delivers anything.
//
// I/O happens in events and timers only; ui.render reads $.state and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, On, RenderElement, RenderInput } from 'claude-code'

import type { PagerState, Tab } from '../types'
import {
  agoOf,
  conversationOf,
  exportedOf,
  inboundOf,
  isMissing,
  liveOf,
  nameOf,
  newCountOf,
  newestOf,
  peersOf,
  stampOf,
} from './pager'
import type { Run } from './pager'

export const PANE = 'pager'
const POLL_MS = 5_000
const REFRESH_DEBOUNCE_MS = 300
const SHOWN_ENTRIES = 200

const EMPTY: PagerState = {
  sessionId: '',
  name: null,
  entries: [],
  peers: [],
  newCount: 0,
  live: 0,
  lastAgo: null,
  error: null,
}

const pager = atom({ plugin: 'pager-view', key: 'pager' } as const, EMPTY)
const tab = atom({ plugin: 'pager-view', key: 'tab' } as const, 'messages')

const baselineKey = (sessionId: string) => `baseline:${sessionId}`

async function run($: Engine, argv: string[]): Promise<Run> {
  try {
    return await $.process.run(argv, { timeoutMs: 10_000 })
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

// Module state: a reload starts it over, as it does $.clock timers. `generation`
// moves when the session id changes under the process (/clear, /resume, /branch);
// a refresh begun under an older one is dropped. The baseline lives in $.store,
// keyed by session id, so a reload keeps it and a new session starts its own.
let generation = 0
let isRefreshing = false
let isDirty = false
let pending: { cancel: () => void } | null = null

async function isPaneOpen($: Engine): Promise<boolean> {
  return (await $.ui.panes()).some(one => one.id === PANE)
}

/** Moves the baseline to `newest` when that is later; answers the baseline in force. */
async function baselineAt($: Engine, sessionId: string, newest: number, isSeen: boolean): Promise<number> {
  const stored = await $.store.get(baselineKey(sessionId))
  const current = typeof stored === 'number' ? stored : null
  // No baseline yet: what arrived before this session's first look is not new.
  const next = current === null || (isSeen && newest > current) ? newest : current
  if (next !== current) await $.store.set(baselineKey(sessionId), next)
  return next
}

async function refreshOnce($: Engine): Promise<void> {
  const started = generation
  const sessionId = await $.session.id()
  const isStale = async () => started !== generation || sessionId !== (await $.session.id())
  const settle = async (next: (prev: PagerState) => PagerState) => {
    if (await isStale()) return
    await update($, pager, next)
  }
  const failed = (error: string) =>
    settle(prev => (prev.sessionId === sessionId ? { ...prev, error } : { ...EMPTY, sessionId, error }))

  const whoami = await run($, ['pager', 'whoami', '--session', sessionId])
  if (isMissing(whoami)) return settle(() => ({ ...EMPTY, sessionId }))
  const name = nameOf(whoami)
  if (name !== null && typeof name === 'object') return failed(name.error)
  if (name === null) return settle(() => ({ ...EMPTY, sessionId }))

  const inbound = inboundOf(await run($, ['pager', 'ls', '--session', sessionId]))
  if ('error' in inbound) return failed(inbound.error)
  const rows = exportedOf(await run($, ['pager', 'export']))
  if ('error' in rows) return failed(rows.error)
  const isSeen = await isPaneOpen($)
  // The band counts live peers too, so `who` runs on every refresh (~13 ms measured).
  const who = peersOf(await run($, ['pager', 'who']))
  if ('error' in who) return failed(who.error)
  const now = await $.clock.now()
  if (await isStale()) return

  const baseline = await baselineAt($, sessionId, newestOf(inbound), isSeen)
  const entries = conversationOf(rows, inbound, sessionId).slice(-SHOWN_ENTRIES)
  const last = entries.at(-1)
  await settle(() => ({
    sessionId,
    name,
    entries,
    peers: who,
    newCount: newCountOf(inbound, baseline),
    live: liveOf(who, name),
    lastAgo: last ? agoOf(last.at, now) : null,
    error: null,
  }))
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

/** /pager and a click on the band's name: open the pane, and count the look as seen. */
async function openPane($: Engine): Promise<void> {
  await $.ui.open({ id: PANE, title: 'pager', focus: true })
  // Clear the badge now; the next refresh moves the stored baseline (the pane is open).
  const state = await read($, pager)
  const sessionId = await $.session.id()
  if (state.sessionId === sessionId && state.newCount > 0) {
    await update($, pager, prev => ({ ...prev, newCount: 0 }))
  }
  soon($)
}

async function switched($: Engine): Promise<void> {
  generation += 1
  await update($, pager, () => EMPTY)
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: "Show this session's pager conversation and peers",
      immediate: true,
    })
    const result = await next(e)
    $.clock.every(POLL_MS, () => void refresh($))
    soon($)
    return result
  })

  // These only observe; if one fails, .catch hands back what next settled to (or
  // runs it once when it had not run), so a failure never blocks or repeats work.
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

  on('command.run', { command: PANE }, async $ => {
    await openPane($)
    return {}
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const state = await read($, pager)
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
    const state = await read($, pager)
    const shown = await read($, tab)
    return paneOf($, e, state, shown)
  })
}

const PREVIEW_CHARS = 60

function bandLine($: Engine, e: RenderInput<'AbovePrompt'>, state: PagerState): RenderElement | null {
  if (state.name === null) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const last = state.entries.at(-1)
  const preview = last
    ? last.body.length > PREVIEW_CHARS
      ? `${last.body.slice(0, PREVIEW_CHARS - 1)}…`
      : last.body
    : ''
  return (
    <Box flexDirection="row">
      {/* The name is the way into /pager: a click (or ctrl+x tab, Enter) opens it. */}
      <Button
        key="open-pager"
        label={`✉ ${state.name}`}
        plain
        onPress={() => openPane($)}
      />
      <Text wrap="truncate-end">
        {state.newCount > 0 ? <Text color="warning" bold>{`  ● ${state.newCount} new`}</Text> : ''}
        {last ? (
          <Text>
            {'  '}
            <Text color={last.direction === 'in' ? 'suggestion' : 'success'}>
              {last.direction === 'in' ? '←' : '→'} {last.peer}
            </Text>
            <Text dimColor>
              {state.lastAgo !== null ? ` ${state.lastAgo}` : ''}
              {'  '}
              {preview}
            </Text>
          </Text>
        ) : (
          ''
        )}
        {state.live > 0 ? <Text dimColor>{`  · ${state.live} live`}</Text> : ''}
        {state.error !== null ? <Text dimColor> ?</Text> : ''}
      </Text>
    </Box>
  )
}

const TABS: { tab: Tab; label: string; hotkey: string }[] = [
  { tab: 'messages', label: 'messages', hotkey: '1' },
  { tab: 'peers', label: 'peers', hotkey: '2' },
]

function paneOf($: Engine, e: RenderInput<'Pane'>, state: PagerState, shown: Tab): RenderElement {
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
  const status =
    state.error !== null ? <Text dimColor>⚠ pager: {state.error}</Text> : ''
  if (state.name === null) {
    return (
      <Box flexDirection="column">
        {tabs}
        <Text dimColor>This session has no pager name yet.</Text>
        {status}
      </Box>
    )
  }
  const rows = Math.max(1, e.props.scroll.bodyRows - 2)
  const body =
    shown === 'messages' ? (
      state.entries.length === 0 ? (
        <Text dimColor>No messages to or from {state.name} yet.</Text>
      ) : (
        <Box flexDirection="column">
          {state.entries.slice(-rows).map(entry => (
            <Text wrap="truncate-end">
              <Text dimColor>{stampOf(entry.at)} </Text>
              <Text color={entry.direction === 'in' ? 'suggestion' : 'success'}>
                {entry.direction === 'in' ? '←' : '→'} {entry.peer.padEnd(5)}
              </Text>
              {entry.isHuman ? <Text color="claude"> (human)</Text> : ''} {entry.body}
            </Text>
          ))}
        </Box>
      )
    ) : state.peers.length === 0 ? (
      <Text dimColor>loading…</Text>
    ) : (
      <Box flexDirection="column">
        {state.peers.map(peer => (
          <Text wrap="truncate-end" dimColor={peer.host !== 'live'} bold={peer.name === state.name}>
            {peer.host === 'live' ? '●' : '○'} {peer.name.padEnd(5)} {peer.tool.padEnd(6)} {peer.last.padEnd(9)} {peer.root}
          </Text>
        ))}
      </Box>
    )
  return (
    <Box flexDirection="column">
      {tabs}
      {body}
      {status}
    </Box>
  )
}
