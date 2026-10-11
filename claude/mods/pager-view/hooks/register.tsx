// pager-view: this session's pager name and its new mail as one line above the
// prompt, and a /pager pane: the session's chats, and each chat a room of
// bubbles. Read-only: it lists and exports; it never sends, marks or delivers.
//
// I/O happens in events, handlers and timers only; ui.render reads $.state and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, On, RenderElement, RenderInput } from 'claude-code'

import type { Entry, PagerState } from '../types'
import {
  agoOf,
  clockOf,
  conversationOf,
  dayOf,
  exportedOf,
  flatOf,
  foldOf,
  inboundOf,
  isMissing,
  liveOf,
  nameOf,
  newCountOf,
  newestInOf,
  newestOf,
  peersOf,
  roomsOf,
  rosterOf,
  seenOf,
  unreadOf,
} from './pager'
import type { Room, Run } from './pager'

export const PANE = 'pager'
const POLL_MS = 5_000
const REFRESH_DEBOUNCE_MS = 300
const SHOWN_ENTRIES = 200
/** The newest messages a room draws: the engine refuses a drawing over 100,000 characters. */
const ROOM_MESSAGES = 60
/**
 * The body text a room's bubbles may draw together, leaving the rest of the
 * 100,000 to the chrome: unfolded bubbles cost their whole bodies, and past it
 * the oldest give way so the newest and the controls under them stay drawn.
 */
const ROOM_TEXT = 80_000
/** The share of the content width a bubble may take; the rest stays empty on the far side. */
const BUBBLE_SHARE = 0.8

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
  unread: {},
}

const pager = atom({ plugin: 'pager-view', key: 'pager' } as const, EMPTY)
const room = atom({ plugin: 'pager-view', key: 'room' } as const, null)
const cursor = atom({ plugin: 'pager-view', key: 'cursor' } as const, null)
const expanded = atom({ plugin: 'pager-view', key: 'expanded' } as const, [])

const baselineKey = (sessionId: string) => `baseline:${sessionId}`
const seenKey = (sessionId: string) => `seen:${sessionId}`

async function run($: Engine, argv: string[]): Promise<Run> {
  try {
    return await $.process.run(argv, { timeoutMs: 10_000 })
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) }
  }
}

// Module state: a reload starts it over, as it does $.clock timers. `generation`
// moves when the session id changes under the process (/clear, /resume, /branch);
// a refresh begun under an older one is dropped. The baseline and the per-room
// seen map live in $.store, keyed by session id, so a reload keeps them and a new
// session starts its own.
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

/**
 * Moves the baseline to `newest` when that is later. Answers the baseline in
 * force (`next`) and the one before this refresh (`prior`), from which a room
 * met for the first time starts counting.
 */
async function baselineAt(
  $: Engine,
  sessionId: string,
  newest: number,
  isSeen: boolean,
): Promise<{ prior: number; next: number }> {
  const stored = await $.store.get(baselineKey(sessionId))
  const current = typeof stored === 'number' ? stored : null
  // No baseline yet: what arrived before this session's first look is not new.
  const next = current === null || (isSeen && newest > current) ? newest : current
  if (next !== current) await $.store.set(baselineKey(sessionId), next)
  return { prior: current ?? newest, next }
}

function isSeenMap(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(mark => typeof mark === 'number')
  )
}

async function storedSeen($: Engine, sessionId: string): Promise<Record<string, number>> {
  const stored = await $.store.get(seenKey(sessionId))
  return isSeenMap(stored) ? stored : {}
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
  // A room on screen reads its mail as it lands.
  const shownRoom = isSeen ? await read($, room) : null
  // The band counts live peers too, so `who` runs on every refresh (~13 ms measured).
  const who = peersOf(await run($, ['pager', 'who']))
  if ('error' in who) return failed(who.error)
  const now = await $.clock.now()
  // Windows: HOME is only set by a shell profile; the desktop app has USERPROFILE alone.
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  if (await isStale()) return

  const { prior, next: baseline } = await baselineAt($, sessionId, newestOf(inbound), isSeen)
  const entries = conversationOf(rows, inbound, sessionId).slice(-SHOWN_ENTRIES)
  const before = await storedSeen($, sessionId)
  const seen = seenOf(before, entries, prior, shownRoom)
  if (JSON.stringify(seen) !== JSON.stringify(before)) await $.store.set(seenKey(sessionId), seen)
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
    unread: unreadOf(entries, seen),
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

/** /pager and a click on the band's name: open the pane on the chats, and count the look as seen. */
async function openPane($: Engine): Promise<void> {
  // A pane opened anew starts on the chats; one already up stays in its room.
  if (!(await isPaneOpen($))) await update($, room, () => null)
  await $.ui.open({ id: PANE, title: 'pager', focus: true })
  // Clear the badge now; the next refresh moves the stored baseline (the pane is open).
  const state = await read($, pager)
  const sessionId = await $.session.id()
  if (state.sessionId === sessionId && state.newCount > 0) {
    await update($, pager, prev => ({ ...prev, newCount: 0 }))
  }
  soon($)
}

/** Moves the pane's window; a move the surface refuses changes nothing worth telling. */
async function scrollTo($: Engine, to: 'start' | 'end'): Promise<void> {
  await $.ui.scroll({ in: PANE, to }).catch((error: unknown) => ({ deny: String(error) }))
}

/** A press on a chat (or `o` on the cursor's): show its room at the newest bubble, and read it. */
async function openRoom($: Engine, name: string): Promise<void> {
  await update($, room, () => name)
  await update($, cursor, () => name)
  const state = await read($, pager)
  const sessionId = await $.session.id()
  if (state.sessionId === sessionId) {
    const newest = newestInOf(state.entries, name)
    const seen = await storedSeen($, sessionId)
    if (newest > (seen[name] ?? 0)) await $.store.set(seenKey(sessionId), { ...seen, [name]: newest })
    if ((state.unread[name] ?? 0) > 0) {
      const rest = (unread: Record<string, number>) =>
        Object.fromEntries(Object.entries(unread).filter(([peer]) => peer !== name))
      await update($, pager, prev => ({ ...prev, unread: rest(prev.unread) }))
    }
  }
  await scrollTo($, 'end')
}

/** `b` and `‹ chats`: back to the chat list. */
async function leaveRoom($: Engine): Promise<void> {
  await update($, room, () => null)
  await scrollTo($, 'start')
}

/** `j` and `k`: the cursor bar onto the chat at `at`, held inside the list. */
async function moveCursor($: Engine, names: readonly string[], at: number): Promise<void> {
  const name = names[Math.max(0, Math.min(names.length - 1, at))]
  if (name !== undefined) await update($, cursor, () => name)
}

/** A bubble's fold control: unfold it past the fold, or fold it back. */
async function toggleFold($: Engine, id: number): Promise<void> {
  await update($, expanded, prev => (prev.includes(id) ? prev.filter(one => one !== id) : [...prev, id]))
}

/** `e`: unfold every folded bubble of the room; when none is folded, fold them all again. */
async function toggleFolds($: Engine, ids: readonly number[]): Promise<void> {
  await update($, expanded, prev =>
    ids.every(id => prev.includes(id)) ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])],
  )
}

async function switched($: Engine): Promise<void> {
  generation += 1
  await update($, pager, () => EMPTY)
  await update($, room, () => null)
  await update($, cursor, () => null)
  await update($, expanded, () => [])
}

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PANE,
      description: "Show this session's pager chats",
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
    const shown = await read($, room)
    const at = await read($, cursor)
    const open = await read($, expanded)
    return paneOf($, e, { state, shown, at, open })
  })
}

const PREVIEW_CHARS = 60

const previewOf = (body: string) => {
  const flat = flatOf(body)
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat
}

/** A root cut from its start: the end is the folder that tells two sessions apart. */
const startCut = (text: string, cells: number) =>
  text.length > cells ? `…${text.slice(text.length - Math.max(1, cells - 1))}` : text

/** The band line: the way into /pager, new mail, the last message; live peers at the right edge. */
function bandLine($: Engine, e: RenderInput<'AbovePrompt'>, state: PagerState): RenderElement | null {
  if (state.name === null) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const last = state.entries.at(-1)
  return (
    <Box flexDirection="row">
      <Box flexDirection="row" flexShrink={1}>
        {/* The name is the way into /pager: a click (or ctrl+x tab, Enter) opens it. */}
        <Button key="open-pager" label={`✉ ${state.name}`} plain onPress={() => openPane($)} />
        <Text wrap="truncate-end">
          {state.newCount > 0 ? (
            <Text>
              {'  '}
              <Text backgroundColor="warning" color="inverseText" bold>{` ${state.newCount} new `}</Text>
            </Text>
          ) : (
            ''
          )}
          {last ? (
            <Text>
              {'  '}
              <Text bold color={last.direction === 'out' ? 'claude' : undefined}>
                {last.direction === 'in' ? '←' : '→'} {last.peer}
              </Text>
              <Text dimColor>
                {state.lastAgo !== null ? ` ${state.lastAgo}` : ''}
                {'  '}
                {previewOf(last.body)}
              </Text>
            </Text>
          ) : (
            ''
          )}
          {state.error !== null ? <Text dimColor> ?</Text> : ''}
        </Text>
      </Box>
      <Box flexGrow={1} />
      {state.live > 0 ? (
        <Box flexShrink={0} marginLeft={2}>
          <Text>
            <Text color="success">●</Text>
            <Text dimColor> {state.live} live</Text>
          </Text>
        </Box>
      ) : (
        ''
      )}
    </Box>
  )
}

type View = { state: PagerState; shown: string | null; at: string | null; open: number[] }

function paneOf($: Engine, e: RenderInput<'Pane'>, view: View): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  const { state } = view
  // The pane frame is the engine's; the content keeps a column clear on each side.
  const width = Math.max(20, e.props.bodyColumns - 2)
  const status = state.error !== null ? <Text dimColor wrap="truncate-end">⚠ pager: {state.error}</Text> : ''
  if (state.name === null) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>This session has no pager name yet.</Text>
        {status}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      {view.shown === null ? chatsBody($, e, view, state.name, width) : roomBody($, e, view, view.shown, width)}
      {status}
    </Box>
  )
}

/** The chats: this session's name over one two-line row per room, the cursor's marked. */
function chatsBody($: Engine, e: RenderInput<'Pane'>, view: View, self: string, width: number): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { state } = view
  const rooms = roomsOf(state.entries, state.peers, self)
  const total = Object.values(state.unread).reduce((sum, count) => sum + count, 0)
  const header = (
    <Text wrap="truncate-end">
      <Text backgroundColor="claude" color="inverseText" bold>{` ${self} `}</Text>
      {state.live > 0 ? (
        <Text>
          {'  '}
          <Text color="success">●</Text>
          <Text dimColor> {state.live} live</Text>
        </Text>
      ) : (
        ''
      )}
      {total > 0 ? <Text color="warning">{` · ${total} unread`}</Text> : ''}
    </Text>
  )
  if (rooms.length === 0) {
    return (
      <Box flexDirection="column">
        {header}
        <Text> </Text>
        <Text dimColor>No messages to or from {self} yet.</Text>
      </Box>
    )
  }
  const names = rooms.map(one => one.name)
  const at = Math.max(0, view.at === null ? 0 : names.indexOf(view.at))
  const isTerminal = e.surface === 'terminal'
  return (
    <Box flexDirection="column">
      {header}
      <Text> </Text>
      {rooms.map((one, index) => {
        const row = chatRow($, e, state, one, index === at, width)
        // The peers without messages follow the conversations under their own label.
        const isFirstQuiet = one.last === null && index > 0 && rooms[index - 1]!.last !== null
        return isFirstQuiet ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor bold>
              PEERS
            </Text>
            {row}
          </Box>
        ) : (
          row
        )
      })}
      <Text> </Text>
      {isTerminal ? (
        <Box flexDirection="row" columnGap={2}>
          <Button key="down" label="down" hotkey="j" plain onPress={() => moveCursor($, names, at + 1)} />
          <Button key="up" label="up" hotkey="k" plain onPress={() => moveCursor($, names, at - 1)} />
          <Button key="open" label="open" hotkey="o" plain onPress={() => openRoom($, names[at]!)} />
          <Text dimColor wrap="truncate-end">
            · click a name
          </Text>
        </Box>
      ) : (
        <Text dimColor>click a name to open its chat</Text>
      )}
    </Box>
  )
}

/** One chat: presence, name and tool, the age and unread pinned right; the preview under them. */
function chatRow(
  $: Engine,
  e: RenderInput<'Pane'>,
  state: PagerState,
  one: Room,
  isCursor: boolean,
  width: number,
): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isLive = one.peer?.host === 'live'
  const unread = state.unread[one.name] ?? 0
  const age = one.last ? agoOf(one.last.at, state.now) : null
  const bar = (
    <Box width={2} flexShrink={0}>
      <Text color="claude">{isCursor ? '▌' : ' '}</Text>
    </Box>
  )
  const preview = one.last ? (
    <Text dimColor wrap="truncate-end">
      {one.last.direction === 'out' ? 'you: ' : ''}
      {one.last.isHuman ? <Text color="suggestion">(human) </Text> : ''}
      {previewOf(one.last.body)}
    </Text>
  ) : (
    <Text dimColor wrap="truncate-end">
      no messages yet{one.peer ? ` · ${startCut(one.peer.root, Math.max(8, width - 22))}` : ''}
    </Text>
  )
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        {bar}
        <Box width={2} flexShrink={0}>
          <Text color={isLive ? 'success' : undefined} dimColor={!isLive}>
            {isLive ? '●' : '○'}
          </Text>
        </Box>
        <Box flexShrink={1}>
          <Button
            key={`chat-${one.name}`}
            label={one.name}
            plain
            dimColor={!isLive && one.last === null}
            onPress={() => openRoom($, one.name)}
          />
        </Box>
        {one.peer ? (
          <Box flexShrink={1} marginLeft={1}>
            <Text dimColor wrap="truncate-end">
              {one.peer.tool}
            </Text>
          </Box>
        ) : (
          ''
        )}
        <Box flexGrow={1} />
        {age !== null ? (
          <Box flexShrink={0} marginLeft={1}>
            <Text dimColor>{age}</Text>
          </Box>
        ) : (
          ''
        )}
        {unread > 0 ? (
          <Box flexShrink={0} marginLeft={1}>
            <Text backgroundColor="warning" color="inverseText" bold>{` ${unread} `}</Text>
          </Box>
        ) : (
          ''
        )}
      </Box>
      <Box flexDirection="row">
        {bar}
        <Box flexShrink={1} paddingLeft={2}>
          {preview}
        </Box>
      </Box>
    </Box>
  )
}

/** A room: who it is with, then the conversation as bubbles, the newest at the bottom. */
function roomBody($: Engine, e: RenderInput<'Pane'>, view: View, name: string, width: number): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { state } = view
  const peer = state.peers.find(one => one.name === name) ?? null
  const isLive = peer?.host === 'live'
  const all = state.entries.filter(entry => entry.peer === name)
  const recent = all.slice(-ROOM_MESSAGES)
  const isTerminal = e.surface === 'terminal'
  // The text a full-width bubble wraps at: its share, less the border and padding.
  const inner = Math.max(8, Math.floor(width * BUBBLE_SHARE) - 4)
  // Newest first while the text budget lasts; the newest is always drawn.
  const shown: Entry[] = []
  let left = ROOM_TEXT
  for (let at = recent.length - 1; at >= 0; at--) {
    const entry = recent[at]!
    const cost = drawnOf(entry, view.open.includes(entry.id), inner).text.length
    if (shown.length > 0 && cost > left) break
    left -= cost
    shown.unshift(entry)
  }
  const items: RenderElement[] = []
  if (all.length > shown.length) {
    items.push(
      <Box justifyContent="center">
        <Text dimColor>{`${all.length - shown.length} earlier messages not shown`}</Text>
      </Box>,
    )
  }
  let day = ''
  for (const entry of shown) {
    const today = dayOf(entry.at)
    if (today !== day) {
      items.push(
        <Box justifyContent="center">
          <Text dimColor>{`── ${today} ──`}</Text>
        </Box>,
      )
      day = today
    }
    items.push(bubbleOf($, e, entry, view.open.includes(entry.id), inner))
  }
  // The bubbles past the fold, which `e` unfolds together (Tab reaches `‹ chats` first).
  // Over every recent one, not just those the budget let in: folding them all must
  // leave none unfolded out of sight.
  const foldable = recent.filter(entry => drawnOf(entry, false, inner).hidden > 0).map(entry => entry.id)
  const isAllOpen = foldable.every(id => view.open.includes(id))
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexShrink={0}>
          <Button key="back" label="‹ chats" hotkey="b" plain onPress={() => leaveRoom($)} />
        </Box>
        <Box flexShrink={1} marginLeft={2}>
          <Text wrap="truncate-end">
            <Text bold>{name}</Text>
            {'  '}
            <Text color={isLive ? 'success' : undefined} dimColor={!isLive}>
              {isLive ? '● live' : '○ gone'}
            </Text>
            {peer ? (
              <Text dimColor>{` · ${peer.tool} · ${startCut(peer.root, Math.max(8, width - 26 - name.length - peer.tool.length))}`}</Text>
            ) : (
              ''
            )}
          </Text>
        </Box>
      </Box>
      <Text color="subtle" wrap="truncate-end">
        {'─'.repeat(width)}
      </Text>
      {shown.length === 0 ? <Text dimColor>No messages with {name} yet.</Text> : items}
      <Text> </Text>
      <Box flexDirection="row" columnGap={2}>
        {foldable.length > 0 ? (
          <Button
            key="fold-all"
            label={isAllOpen ? 'fold all' : 'unfold all'}
            hotkey="e"
            plain
            onPress={() => toggleFolds($, foldable)}
          />
        ) : (
          ''
        )}
        <Text dimColor wrap="truncate-end">
          {isTerminal ? '↑↓ scroll' : 'click ▾ to unfold a message'}
        </Text>
      </Box>
    </Box>
  )
}

/**
 * One message as a bubble hugging its side: received on the left in `subtle`,
 * sent on the right in the accent, a fifth of the width left empty opposite.
 */
/** What a bubble's body draws: folded past FOLD_LINES unless it is open. */
function drawnOf(entry: Entry, isOpen: boolean, inner: number): { text: string; hidden: number; isFolded: boolean } {
  const body = entry.body.replace(/\s+$/, '')
  const fold = foldOf(body, inner)
  const isFolded = fold.hidden > 0 && !isOpen
  return { text: isFolded ? fold.text : body, hidden: fold.hidden, isFolded }
}

function bubbleOf($: Engine, e: RenderInput<'Pane'>, entry: Entry, isOpen: boolean, inner: number): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isOut = entry.direction === 'out'
  const { text, hidden, isFolded } = drawnOf(entry, isOpen, inner)
  const left = entry.length - entry.body.length
  const spacer = <Box width={`${Math.round((1 - BUBBLE_SHARE) * 100)}%`} flexShrink={0} />
  const card = (
    <Box
      flexDirection="column"
      flexShrink={1}
      borderStyle="round"
      borderColor={isOut ? 'claude' : 'subtle'}
      paddingX={1}
    >
      {text.split('\n').map(line => (
        <Text wrap="wrap">{line === '' ? ' ' : line}</Text>
      ))}
      {!isFolded && left > 0 ? (
        <Text dimColor wrap="wrap">
          … {left.toLocaleString('en-US')} more characters · full text: pager export (#{entry.id})
        </Text>
      ) : (
        ''
      )}
      {/* Justified rather than parted by a growing Box: a grower widens the bubble to its
          most, where justifying leaves it as wide as its longest line. */}
      <Box flexDirection="row" justifyContent={hidden > 0 ? 'space-between' : 'flex-end'}>
        {hidden > 0 ? (
          <Button
            key={`fold-${entry.id}`}
            label={isFolded ? `▾ ${hidden} more lines` : '▴ fold'}
            plain
            dimColor
            onPress={() => toggleFold($, entry.id)}
          />
        ) : (
          ''
        )}
        <Box flexShrink={0} marginLeft={2}>
          <Text>
            {entry.isHuman ? <Text color="suggestion">(human) </Text> : ''}
            <Text dimColor>{clockOf(entry.at)}</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  )
  return (
    <Box key={`bubble-${entry.id}`} flexDirection="row" justifyContent={isOut ? 'flex-end' : 'flex-start'}>
      {isOut ? spacer : ''}
      {card}
      {isOut ? '' : spacer}
    </Box>
  )
}
