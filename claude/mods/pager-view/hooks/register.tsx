// pager-view: this session's pager name and its new mail as one line above the
// prompt, and a /pager pane with the session's conversation and its peers.
// Read-only: it lists and exports; it never sends, marks or delivers anything.
//
// I/O happens in events and timers only; ui.render reads $.state and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, On, RenderElement, RenderInput } from 'claude-code'

import type { Entry, PagerState, Tab } from '../types'
import {
  agoOf,
  conversationOf,
  exportedOf,
  flatOf,
  inboundOf,
  isMissing,
  liveOf,
  nameOf,
  newCountOf,
  newestOf,
  peersOf,
  rosterOf,
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
  now: 0,
  error: null,
}

const pager = atom({ plugin: 'pager-view', key: 'pager' } as const, EMPTY)
const tab = atom({ plugin: 'pager-view', key: 'tab' } as const, 'messages')
const pick = atom({ plugin: 'pager-view', key: 'pick' } as const, null)

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
//
// These are module-level, which assumes one hooks-module instance per session.
// That is what the engine documents -- a folder is loaded "for that session
// only" and $.session.id() takes no argument -- but it is nowhere stated
// outright, so it is written down here as the assumption it is. Were one
// process to share an instance across sessions, `pending?.cancel()` in soon()
// would drop another session's scheduled refresh, `generation` would void its
// running one, and `isRefreshing` would serialise their I/O; the fix then is
// to key all four by session id.
//
// Baselines are never pruned: one `baseline:<uuid>` per session, forever, in a
// $.store capped at 4 MiB of JSON. At ~55 bytes an entry that is tens of
// thousands of sessions away, and $.store.keys()/delete are there if it ever
// matters -- but it is accumulation, not a leak that stops.
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
  // `pager export` dumps the whole database and takes no arguments -- it says
  // so itself, pointing at jq -- so this grows with the message count rather
  // than with this session's share of it. Measured at ~1.9 KB a message
  // against $.process.run's 4 MiB stdout cap, which is a ceiling somewhere
  // near 2,200 messages. Past it `failureOf` answers 'output truncated' every
  // refresh and the band holds its last good line with a dim `?`, for good:
  // the database only grows back. The pane spells the reason out (`⚠ pager:
  // output truncated`), which is the only warning there is. A real fix needs
  // a filter on `pager export`, not a change here.
  const rows = exportedOf(await run($, ['pager', 'export']))
  if ('error' in rows) return failed(rows.error)
  const isSeen = await isPaneOpen($)
  // The band counts live peers too, so `who` runs on every refresh (~13 ms measured).
  const who = peersOf(await run($, ['pager', 'who']))
  if ('error' in who) return failed(who.error)
  const now = await $.clock.now()
  const home = (await $.env.get('HOME')) ?? ''
  if (await isStale()) return

  const baseline = await baselineAt($, sessionId, newestOf(inbound), isSeen)
  const entries = conversationOf(rows, inbound, sessionId).slice(-SHOWN_ENTRIES)
  const last = entries.at(-1)
  await settle(() => ({
    sessionId,
    name,
    entries,
    peers: rosterOf(who, home),
    newCount: newCountOf(inbound, baseline),
    live: liveOf(who, name),
    lastAgo: last ? agoOf(last.at, now) : null,
    now,
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
  await update($, pick, () => null)
}

/** `j`, `k` and a press on a message's time: which message the reader shows. */
async function pickMessage($: Engine, id: number | null): Promise<void> {
  await update($, pick, () => id)
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
    const picked = await read($, pick)
    return paneOf($, e, state, shown, picked)
  })
}

const PREVIEW_CHARS = 60

function bandLine($: Engine, e: RenderInput<'AbovePrompt'>, state: PagerState): RenderElement | null {
  if (state.name === null) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const last = state.entries.at(-1)
  const flat = last ? flatOf(last.body) : ''
  const preview = flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
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

function paneOf(
  $: Engine,
  e: RenderInput<'Pane'>,
  state: PagerState,
  shown: Tab,
  picked: number | null,
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
  const status = state.error !== null ? <Text dimColor>⚠ pager: {state.error}</Text> : ''
  if (state.name === null) {
    return (
      <Box flexDirection="column">
        {tabs}
        <Text dimColor>This session has no pager name yet.</Text>
        {status}
      </Box>
    )
  }
  const body =
    shown === 'messages'
      ? state.entries.length === 0
        ? <Text dimColor>No messages to or from {state.name} yet.</Text>
        : messagesBody($, e, state, picked)
      : peersBody($, e, state)
  return (
    <Box flexDirection="column">
      {tabs}
      {body}
      {status}
    </Box>
  )
}

const arrowOf = (entry: Entry) => (entry.direction === 'in' ? '←' : '→')
const toneOf = (entry: Entry) => (entry.direction === 'in' ? 'suggestion' : 'success')

/**
 * The messages tab: an index of recent messages over a reader that shows the
 * picked one (the newest when none is picked) in full.
 */
function messagesBody($: Engine, e: RenderInput<'Pane'>, state: PagerState, picked: number | null): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const entries = state.entries
  const found = picked === null ? -1 : entries.findIndex(entry => entry.id === picked)
  const at = found < 0 ? entries.length - 1 : found
  const entry = entries[at]!
  // The index keeps the picked row in its window, the newest at the bottom.
  const size = Math.min(entries.length, Math.max(3, Math.floor(e.props.scroll.bodyRows * 0.35)))
  const first = Math.max(0, Math.min(entries.length - size, at - Math.floor(size / 2)))
  const windowed = entries.slice(first, first + size)
  const older = at > 0 ? entries[at - 1]!.id : null
  // Stepping onto the newest returns to following new mail.
  const newer = at < entries.length - 1 ? (at + 1 === entries.length - 1 ? null : entries[at + 1]!.id) : undefined
  const age = agoOf(entry.at, state.now)
  const header = `── #${entry.id} · ${arrowOf(entry)} ${entry.peer}${entry.isHuman ? ' (human)' : ''} · ${stampOf(entry.at)}${
    age === null ? '' : age === 'now' ? ' · just now' : ` · ${age} ago`
  } `
  const isTerminal = e.surface === 'terminal'
  const rule = isTerminal ? '─'.repeat(Math.max(2, e.props.bodyColumns - header.length)) : '──'
  const left = entry.length - entry.body.length
  return (
    <Box flexDirection="column">
      {windowed.map(one => {
        const isPicked = one === entry
        return (
          <Box flexDirection="row">
            <Text color="claude">{isPicked ? '▌' : ' '}</Text>
            <Button
              key={`msg-${one.id}`}
              label={stampOf(one.at)}
              plain
              dimColor={!isPicked}
              onPress={() => pickMessage($, one === entries.at(-1) ? null : one.id)}
            />
            <Box flexShrink={1}>
              <Text wrap="truncate-end">
                {' '}
                <Text color={toneOf(one)}>
                  {arrowOf(one)} {one.peer.padEnd(5)}
                </Text>
                {one.isHuman ? <Text color="claude"> (human)</Text> : ''}
                <Text bold={isPicked}> {flatOf(one.body)}</Text>
              </Text>
            </Box>
          </Box>
        )
      })}
      <Text> </Text>
      <Text color="subtle" wrap="truncate-end">
        {header}
        {rule}
      </Text>
      {entry.body.split('\n').map(line => (
        <Text wrap="wrap">{line === '' ? ' ' : line}</Text>
      ))}
      {left > 0 ? (
        <Text dimColor wrap="wrap">
          … {left.toLocaleString('en-US')} more characters · full text: pager export (#{entry.id})
        </Text>
      ) : (
        ''
      )}
      <Text> </Text>
      <Box flexDirection="row" columnGap={2}>
        <Button
          key="older"
          label="older"
          hotkey="j"
          plain
          dimColor={older === null}
          onPress={() => (older === null ? undefined : pickMessage($, older))}
        />
        <Button
          key="newer"
          label="newer"
          hotkey="k"
          plain
          dimColor={newer === undefined}
          onPress={() => (newer === undefined ? undefined : pickMessage($, newer))}
        />
        <Text dimColor wrap="truncate-end">
          {isTerminal ? '· 1 2 tabs · ↑↓ scroll' : '· click a time to read it'}
        </Text>
      </Box>
    </Box>
  )
}

const COLUMNS = { name: 6, tool: 7, host: 8, last: 10 }

const startCut = (text: string, room: number) => (text.length > room ? `…${text.slice(text.length - room + 1)}` : text)

/** The peers tab: aligned columns, live hosts first, this session marked. */
function peersBody($: Engine, e: RenderInput<'Pane'>, state: PagerState): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  if (state.peers.length === 0) return <Text dimColor>loading…</Text>
  const cell = (width: number, text: string, extra: Record<string, boolean> = {}) => (
    <Box width={width + 1} flexShrink={0}>
      <Text wrap="truncate-end" {...extra}>
        {text}
      </Text>
    </Box>
  )
  // The root takes what the fixed columns leave; cut from its start, it keeps
  // the folder that tells two sessions apart.
  const fixed = 2 + COLUMNS.name + COLUMNS.tool + COLUMNS.host + COLUMNS.last + 4
  const room = Math.max(8, e.props.bodyColumns - fixed)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text dimColor>{'  '}</Text>
        {cell(COLUMNS.name, 'name', { dimColor: true })}
        {cell(COLUMNS.tool, 'tool', { dimColor: true })}
        {cell(COLUMNS.host, 'host', { dimColor: true })}
        {cell(COLUMNS.last, 'last', { dimColor: true })}
        <Text dimColor>root</Text>
      </Box>
      {state.peers.map(peer => {
        const isLive = peer.host === 'live'
        const isSelf = peer.name === state.name
        const tone = { dimColor: !isLive, bold: isSelf }
        return (
          <Box flexDirection="row">
            <Box width={2} flexShrink={0}>
              <Text color={isLive ? 'success' : undefined} dimColor={!isLive}>
                {isLive ? '●' : '○'}
              </Text>
            </Box>
            {cell(COLUMNS.name, peer.name, tone)}
            {cell(COLUMNS.tool, peer.tool, tone)}
            {cell(COLUMNS.host, peer.host, tone)}
            {cell(COLUMNS.last, peer.last, tone)}
            <Text dimColor={!isLive} bold={isSelf}>
              {startCut(`${peer.root}${isSelf ? ' (this)' : ''}`, room)}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
