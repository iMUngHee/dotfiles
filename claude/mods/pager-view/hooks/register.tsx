// pager-view: this session's pager name and its new mail as one line above the
// prompt, and a /pager pane: the session's chats, and each chat a room drawn
// as a transcript. Read-only: it lists and exports; it never sends, marks or delivers.
//
// I/O happens in events, handlers and timers only; ui.render reads $.state and nothing else.

import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, On, RenderElement, RenderInput } from 'claude-code'

import type { Entry, Opened, PagerState } from '../types'
import {
  agoOf,
  cellsOf,
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
  runStartsOf,
  seenOf,
  unreadOf,
} from './pager'
import type { Room, Run } from './pager'

export const PANE = 'pager'
const POLL_MS = 5_000
const REFRESH_DEBOUNCE_MS = 300
// How often the session id is compared, well inside POLL_MS; see watchSession.
const SESSION_WATCH_MS = 1_000
const SHOWN_ENTRIES = 200
/** The newest messages a room draws: the engine refuses a drawing over 100,000 characters. */
const ROOM_MESSAGES = 60
/**
 * The body text a room's messages may draw together, leaving the rest of the
 * 100,000 to the chrome: unfolded messages cost their whole bodies, and past it
 * the oldest give way so the newest and the controls under them stay drawn.
 */
const ROOM_TEXT = 80_000
/** The cells a body gives up to its indent or bar: two either way, and one spare for the quote's far side. */
const BODY_INSET = 3
/** The key of the `new` divider, which opening a room with unread scrolls to. */
const NEW_KEY = 'new'
/** How long, and how many times, opening a room waits for the divider to be drawn before giving up. */
const NEW_RETRY_MS = 60
const NEW_TRIES = 5

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
const opened = atom({ plugin: 'pager-view', key: 'opened' } as const, null)
const folds = atom({ plugin: 'pager-view', key: 'folds' } as const, {})

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
// running one, `isRefreshing` would serialise their I/O, and `sessionSeen`
// would see the id flip on every watch and wipe each view in turn; the fix
// then is to key all five by session id.
//
// Baselines are never pruned: one `baseline:<uuid>` per session, forever, in a
// $.store capped at 4 MiB of JSON. At ~55 bytes an entry that is tens of
// thousands of sessions away, and $.store.keys()/delete are there if it ever
// matters -- but it is accumulation, not a leak that stops.
let generation = 0
let isRefreshing = false
let isDirty = false
let pending: { cancel: () => void } | null = null
// The id watchSession last saw.
let sessionSeen = ''

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

/**
 * A press on a chat (or `o` on the cursor's): show its room, and read it. The
 * room opens at its first unread message, under the `new` divider, or at its
 * end when nothing is unread; what was unread stays whole until folded.
 */
async function openRoom($: Engine, name: string): Promise<void> {
  const state = await read($, pager)
  const sessionId = await $.session.id()
  const isCurrent = state.sessionId === sessionId
  const seen = isCurrent ? await storedSeen($, sessionId) : {}
  const mark = seen[name]
  const mine = isCurrent ? state.entries.filter(entry => entry.peer === name) : []
  // Unread is what `unreadOf` counts: inbound past the room's mark. No mark, nothing unread.
  const firstNew =
    mark === undefined ? undefined : mine.find(entry => entry.direction === 'in' && entry.id > mark)?.id
  const at: Opened = { room: name, firstNew: firstNew ?? null, newest: mine.at(-1)?.id ?? 0 }
  await update($, opened, () => at)
  await update($, folds, () => ({}))
  await update($, room, () => name)
  await update($, cursor, () => name)
  if (isCurrent) {
    const newest = newestInOf(state.entries, name)
    if (newest > (mark ?? 0)) await $.store.set(seenKey(sessionId), { ...seen, [name]: newest })
    if ((state.unread[name] ?? 0) > 0) {
      const rest = (unread: Record<string, number>) =>
        Object.fromEntries(Object.entries(unread).filter(([peer]) => peer !== name))
      await update($, pager, prev => ({ ...prev, unread: rest(prev.unread) }))
    }
  }
  if (at.firstNew === null) return scrollTo($, 'end')
  revealNew($, name, NEW_TRIES)
}

/**
 * Brings the `new` divider to the top of the pane. The press that opened the
 * room asks before the room is drawn, and a key not yet drawn is refused
 * (measured: no `ui.scroll` reached the engine), so it asks again on a short
 * timer until the divider is there; out of tries, it settles for the room's
 * end. It stops once the room in view is another, or the person moved the
 * window first. Unawaited, so the press does not wait.
 */
function revealNew($: Engine, name: string, tries: number): void {
  $.clock.after(NEW_RETRY_MS, () => {
    void (async () => {
      if ((await read($, room)) !== name) return
      const result = await $.ui
        .scroll({ in: PANE, to: { key: NEW_KEY }, block: 'start' })
        .catch((error: unknown) => ({ deny: String(error) }))
      if (result.deny === undefined || /moved meanwhile/.test(result.deny)) return
      if (tries > 1) revealNew($, name, tries - 1)
      else await scrollTo($, 'end')
    })()
  })
}

/** `b` and `‹ chats`: back to the chat list. */
async function leaveRoom($: Engine): Promise<void> {
  await update($, room, () => null)
  await update($, opened, () => null)
  await scrollTo($, 'start')
}

/** `j` and `k`: the cursor bar onto the chat at `at`, held inside the list. */
async function moveCursor($: Engine, names: readonly string[], at: number): Promise<void> {
  const name = names[Math.max(0, Math.min(names.length - 1, at))]
  if (name !== undefined) await update($, cursor, () => name)
}

/** A message's fold control: unfold it past the fold, or fold it back. `isOpen` is how it is drawn now. */
async function toggleFold($: Engine, id: number, isOpen: boolean): Promise<void> {
  await update($, folds, prev => ({ ...prev, [id]: !isOpen }))
}

/** `e`: unfold every folded message of the room (`isAllOpen` false); when none is folded, fold them all. */
async function toggleFolds($: Engine, ids: readonly number[], isAllOpen: boolean): Promise<void> {
  await update($, folds, prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, !isAllOpen])) }))
}

async function switched($: Engine): Promise<void> {
  generation += 1
  await update($, pager, () => EMPTY)
  await update($, room, () => null)
  await update($, cursor, () => null)
  await update($, opened, () => null)
  await update($, folds, () => ({}))
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
      description: "Show this session's pager chats",
      immediate: true,
    })
    const result = await next(e)
    sessionSeen = await $.session.id()
    $.clock.every(POLL_MS, () => void refresh($))
    $.clock.every(SESSION_WATCH_MS, () => void watchSession($))
    soon($)
    return result
  })

  // If it fails, .catch hands back what next settled to (or runs it once when it
  // had not run), so a failure never blocks or repeats work.
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
    const was = await read($, opened)
    const set = await read($, folds)
    return paneOf($, e, { state, shown, at, opened: was, folds: set })
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

type View = {
  state: PagerState
  shown: string | null
  at: string | null
  opened: Opened | null
  folds: Record<string, boolean>
}

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
      {view.shown === null ? chatsBody($, e, view, state.name) : roomBody($, e, view, view.shown, width)}
      {status}
    </Box>
  )
}

/** The chats: this session's name over one two-line row per conversation, the cursor's marked. */
function chatsBody($: Engine, e: RenderInput<'Pane'>, view: View, self: string): RenderElement {
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
        <Text bold>No conversations yet.</Text>
        <Text dimColor>Messages {self} sends or receives show up here.</Text>
      </Box>
    )
  }
  const names = rooms.map(one => one.name)
  const at = Math.max(0, view.at === null ? 0 : names.indexOf(view.at))
  const isTerminal = e.surface === 'terminal'
  return (
    <Box flexDirection="column">
      {header}
      {rooms.map((one, index) => (
        <Box key={`row-${one.name}`} flexDirection="column" marginTop={1}>
          {chatRow($, e, state, one, index === at)}
        </Box>
      ))}
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

/**
 * One chat: presence, name and tool, the age pinned right; under them the
 * preview after who said it, the unread chip pinned right. Unread lights the
 * preview: a Button has no weight of its own to set on the name.
 */
function chatRow($: Engine, e: RenderInput<'Pane'>, state: PagerState, one: Room, isCursor: boolean): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const isLive = one.peer?.host === 'live'
  const unread = state.unread[one.name] ?? 0
  const age = agoOf(one.last.at, state.now)
  const bar = (
    <Box width={2} flexShrink={0}>
      <Text color="claude">{isCursor ? '▌' : ' '}</Text>
    </Box>
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
          <Button key={`chat-${one.name}`} label={one.name} plain onPress={() => openRoom($, one.name)} />
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
      </Box>
      <Box flexDirection="row">
        {bar}
        <Box flexShrink={1} paddingLeft={2}>
          <Text dimColor={unread === 0} wrap="truncate-end">
            {one.last.isHuman ? <Text color="suggestion">(human) </Text> : ''}
            {one.last.direction === 'out' ? 'you: ' : `${one.name}: `}
            {previewOf(one.last.body)}
          </Text>
        </Box>
        <Box flexGrow={1} />
        {unread > 0 ? (
          <Box flexShrink={0} marginLeft={1}>
            <Text backgroundColor="warning" color="inverseText" bold>{` ${unread} `}</Text>
          </Box>
        ) : (
          ''
        )}
      </Box>
    </Box>
  )
}

/** What a message's body draws: folded past FOLD_LINES unless it is open. */
function drawnOf(entry: Entry, isOpen: boolean, inner: number): { text: string; hidden: number; isFolded: boolean } {
  const body = entry.body.replace(/\s+$/, '')
  const fold = foldOf(body, inner)
  const isFolded = fold.hidden > 0 && !isOpen
  return { text: isFolded ? fold.text : body, hidden: fold.hidden, isFolded }
}

/**
 * A full-width rule with `label` centred: a day (the rule `subtle`, the date
 * dim, which reads where `subtle` text would not), or the `new` divider.
 */
function ruleOf(
  $: Engine,
  e: RenderInput<'Pane'>,
  label: string,
  color: 'subtle' | 'warning',
  width: number,
): RenderElement {
  const { Text } = $.ui.resolve(e)
  const side = Math.max(0, width - cellsOf(label))
  const left = Math.floor(side / 2)
  return (
    <Text color={color} wrap="truncate-end">
      {'─'.repeat(left)}
      {color === 'subtle' ? <Text dimColor>{label}</Text> : label}
      {'─'.repeat(side - left)}
    </Text>
  )
}

type Group = { direction: 'in' | 'out'; entries: Entry[] }

/**
 * A room: who it is with, then the conversation as a transcript, oldest first:
 * the peer's runs under a `●` sender line, this session's beside an accent
 * bar, a rule for each day and one above the first message unread at open;
 * then the way back, pinned under the newest.
 */
function roomBody($: Engine, e: RenderInput<'Pane'>, view: View, name: string, width: number): RenderElement {
  const { Box, Text, Button, Markdown } = $.ui.resolve(e)
  const { state } = view
  const peer = state.peers.find(one => one.name === name) ?? null
  const isLive = peer?.host === 'live'
  const all = state.entries.filter(entry => entry.peer === name)
  const recent = all.slice(-ROOM_MESSAGES)
  const isTerminal = e.surface === 'terminal'
  const was = view.opened?.room === name ? view.opened : null
  // Whole by default: from the first unread at open (or the newest then) on.
  const wholeFrom = was ? (was.firstNew ?? was.newest) : (recent.at(-1)?.id ?? 0)
  const isOpenOf = (entry: Entry) => view.folds[entry.id] ?? entry.id >= wholeFrom
  const inner = Math.max(8, width - BODY_INSET)
  // Newest first while the text budget lasts; the newest is always drawn.
  const shown: Entry[] = []
  let left = ROOM_TEXT
  for (let at = recent.length - 1; at >= 0; at--) {
    const entry = recent[at]!
    const cost = drawnOf(entry, isOpenOf(entry), inner).text.length
    if (shown.length > 0 && cost > left) break
    left -= cost
    shown.unshift(entry)
  }
  // The divider sits above the first unread message; when that one is past what
  // is drawn (60 messages, the text budget), above the first drawn, all unread too.
  const unreadFrom = was?.firstNew ?? null
  const firstShown = shown[0]?.id ?? null
  const firstNew =
    unreadFrom !== null && firstShown !== null && unreadFrom < firstShown ? firstShown : unreadFrom
  const starts = runStartsOf(shown, firstNew)
  const runs: Group[] = []
  for (const entry of shown) {
    if (starts.has(entry.id) || runs.length === 0) runs.push({ direction: entry.direction, entries: [entry] })
    else runs.at(-1)!.entries.push(entry)
  }
  // The messages past the fold, which `e` unfolds together (Tab reaches `‹ chats` first).
  // Over every recent one, not just those the budget let in: folding them all must
  // leave none unfolded out of sight.
  const foldable = recent.filter(entry => drawnOf(entry, false, inner).hidden > 0).map(entry => entry.id)
  const isAllOpen = foldable.every(id => view.folds[id] ?? id >= wholeFrom)

  const messageOf = (entry: Entry, isFirst: boolean) => {
    const isOpen = isOpenOf(entry)
    const { text, hidden, isFolded } = drawnOf(entry, isOpen, inner)
    const rest = entry.length - entry.body.length
    return (
      <Box key={`message-${entry.id}`} flexDirection="column" marginTop={isFirst ? 0 : 1}>
        {isFirst ? '' : <Text dimColor>{clockOf(entry.at)}</Text>}
        <Markdown text={text} />
        {!isFolded && rest > 0 ? (
          <Text dimColor wrap="wrap">
            … {rest.toLocaleString('en-US')} more characters · full text: pager export (#{entry.id})
          </Text>
        ) : (
          ''
        )}
        {hidden > 0 ? (
          <Box>
            <Button
              key={`fold-${entry.id}`}
              label={isFolded ? `▾ ${hidden} more lines` : '▴ fold'}
              plain
              dimColor
              onPress={() => toggleFold($, entry.id, isOpen)}
            />
          </Box>
        ) : (
          ''
        )}
      </Box>
    )
  }
  const senderOf = (run: Group) => {
    const first = run.entries[0]!
    const human = first.isHuman ? <Text color="suggestion">{'  (human)'}</Text> : ''
    return run.direction === 'out' ? (
      <Text>
        <Text bold color="claude">
          you
        </Text>
        <Text dimColor>{`  ${clockOf(first.at)}`}</Text>
        {human}
      </Text>
    ) : (
      <Text wrap="truncate-end">
        {'● '}
        <Text bold>{name}</Text>
        <Text dimColor>{`  ${clockOf(first.at)}`}</Text>
        {human}
      </Text>
    )
  }
  const messagesOf = (run: Group) => run.entries.map((entry, index) => messageOf(entry, index === 0))
  const receivedOf = (run: Group, isAfterBar: boolean) => (
    <Box key={`run-${run.entries[0]!.id}`} flexDirection="column" marginTop={isAfterBar ? 0 : 1}>
      {senderOf(run)}
      <Box flexDirection="column" paddingLeft={2}>
        {messagesOf(run)}
      </Box>
    </Box>
  )
  // Sent runs that follow one another share one bar, a blank row apart inside it, so two
  // never stack their borders' blank rows into a double gap.
  const sentOf = (group: Group[]) => {
    const key = `run-${group[0]!.entries[0]!.id}`
    const parts = group.map((run, index) => (
      <Box key={`sent-${run.entries[0]!.id}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
        {senderOf(run)}
        {messagesOf(run)}
      </Box>
    ))
    // The terminal's `quote` border is the bar (`▎`), its blank top and bottom rows the
    // spacing. The desktop draws any borderStyle as a whole rounded box, so there the bar
    // is a filled cell beside the runs.
    return isTerminal ? (
      <Box key={key} flexDirection="column" borderStyle="quote" borderColor="claude" paddingLeft={1}>
        {parts}
      </Box>
    ) : (
      <Box key={key} flexDirection="row" marginTop={1}>
        <Box width={1} flexShrink={0} backgroundColor="claude" />
        <Box flexDirection="column" flexGrow={1} flexShrink={1} paddingLeft={1}>
          {parts}
        </Box>
      </Box>
    )
  }

  const items: RenderElement[] = []
  if (all.length > shown.length) {
    items.push(
      <Box key="earlier" justifyContent="center" marginTop={1}>
        <Text dimColor>{`${all.length - shown.length} earlier messages not shown`}</Text>
      </Box>,
    )
  }
  let day = ''
  // Whether the last item is a terminal bar, whose bottom row already spaces what follows.
  let isAfterBar = false
  let bar: Group[] = []
  const flush = () => {
    if (bar.length === 0) return
    items.push(sentOf(bar))
    bar = []
    isAfterBar = isTerminal
  }
  for (const run of runs) {
    const first = run.entries[0]!
    const today = dayOf(first.at)
    const isNewDay = today !== day
    if (isNewDay || first.id === firstNew) flush()
    if (isNewDay) {
      items.push(
        <Box key={`day-${first.id}`} marginTop={isAfterBar ? 0 : 1}>
          {ruleOf($, e, ` ${today} `, 'subtle', width)}
        </Box>,
      )
      day = today
      isAfterBar = false
    }
    if (first.id === firstNew) {
      items.push(
        <Box key={NEW_KEY} marginTop={isAfterBar ? 0 : 1}>
          {ruleOf($, e, ' new ', 'warning', width)}
        </Box>,
      )
      isAfterBar = false
    }
    if (run.direction === 'out') {
      bar.push(run)
      continue
    }
    flush()
    items.push(receivedOf(run, isAfterBar))
    isAfterBar = false
  }
  flush()
  const presence = (
    <Text color={isLive ? 'success' : undefined} dimColor={!isLive}>
      {isLive ? '● live' : '○ gone'}
    </Text>
  )
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexShrink={0}>
          <Button key="back-top" label="‹ chats" plain onPress={() => leaveRoom($)} />
        </Box>
        <Box flexShrink={1} marginLeft={2}>
          <Text wrap="truncate-end">
            <Text bold>{name}</Text>
            {'  '}
            {presence}
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
      {isAfterBar ? '' : <Text> </Text>}
      <Text color="subtle" wrap="truncate-end">
        {'─'.repeat(width)}
      </Text>
      <Box flexDirection="row">
        <Box flexShrink={0}>
          <Button key="back" label="‹ chats" hotkey="b" plain onPress={() => leaveRoom($)} />
        </Box>
        <Box flexShrink={1} marginLeft={2}>
          <Text wrap="truncate-end">
            <Text bold>{name}</Text> {presence}
          </Text>
        </Box>
        <Box flexGrow={1} />
        {foldable.length > 0 ? (
          <Box flexShrink={0} marginLeft={2}>
            <Button
              key="fold-all"
              label={isAllOpen ? 'fold all' : 'unfold all'}
              hotkey="e"
              plain
              onPress={() => toggleFolds($, foldable, isAllOpen)}
            />
          </Box>
        ) : (
          ''
        )}
      </Box>
    </Box>
  )
}
