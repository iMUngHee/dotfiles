// Pure readers for pager-view: what the pager CLI prints, turned into this
// session's name, its conversation and its peers. register.tsx does the I/O.

import type { Entry, Peer } from '../types'

export type { Entry, Peer }

/** What one `$.process.run` answered, the fields these readers look at. */
export type Run = {
  exitCode: number
  stdout: string
  stderr: string
  isStdoutTruncated?: boolean
}

export type Failure = { error: string }

/** The run's failure, if it failed: a non-zero exit or output cut short. */
export function failureOf(run: Run): string | undefined {
  if (run.isStdoutTruncated) return 'output truncated'
  if (run.exitCode !== 0) {
    return run.stderr.trim().split('\n').at(-1) || `exit ${run.exitCode}`
  }
  return undefined
}

/** A run that never started because `pager` is not installed. */
export function isMissing(run: Run): boolean {
  return run.exitCode === -1 && /ENOENT|not found|No such file/i.test(run.stderr)
}

/**
 * `pager whoami --session <id>`: the `name:` line, or null when it has none.
 *
 * Only the first whitespace-separated field is the name, and `none` is not a
 * name. An unnamed session makes whoami print a sentence, not a blank —
 * `name:    none — it is assigned once a hook runs with the host detected` —
 * so taking the rest of the line draws that whole sentence where the name goes
 * and never reaches the `null` branch the band and pane check for. Both guards
 * were in the statusline this mod replaced; they are the same two.
 */
export function nameOf(run: Run): string | null | Failure {
  const failure = failureOf(run)
  if (failure) return { error: failure }
  const line = run.stdout.split('\n').find(one => /^name:/.test(one))
  const name = line?.replace(/^name:\s*/, '').trim().split(/\s+/)[0]
  if (!name || name === 'none') return null
  return name
}

/**
 * `pager ls --session <id>`: the ids of the messages addressed to this session,
 * under any of its names. Only the ID column (`#<n>`) is read.
 */
export function inboundOf(run: Run): Set<number> | Failure {
  const failure = failureOf(run)
  if (failure) return { error: failure }
  const lines = run.stdout.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0 || (lines.length === 1 && lines[0]!.trim() === 'nothing here')) {
    return new Set()
  }
  if (!/^ID\s+INBOX\b/.test(lines[0]!)) return { error: 'unexpected ls output' }
  const ids = new Set<number>()
  for (const line of lines.slice(1)) {
    const m = /^#(\d+)\s/.exec(line)
    if (m) ids.add(Number(m[1]))
  }
  return ids
}

type Exported = {
  v?: number
  id?: number
  created_at?: string
  alias?: string
  sender_session?: string | null
  sender_label?: string | null
  origin?: string
  body?: string
}

/** `pager export` JSONL, the rows of version 1. */
export function exportedOf(run: Run): Exported[] | Failure {
  const failure = failureOf(run)
  if (failure) return { error: failure }
  const rows: Exported[] = []
  for (const line of run.stdout.split('\n')) {
    if (line.trim() === '') continue
    try {
      const row = JSON.parse(line) as Exported
      if (row.v === 1 && typeof row.id === 'number') rows.push(row)
    } catch {
      return { error: 'unreadable export line' }
    }
  }
  return rows
}

/** The most of a body kept and drawn; the rest is named, with the way to read it. */
export const BODY_CAP = 6_000

/** A body on one line, as the band and the message index show it. */
export function flatOf(body: string): string {
  return body.trim().replace(/\s*\n\s*/g, ' ⏎ ')
}

/** This session's conversation: what it received (by id) and what it sent. */
export function conversationOf(
  rows: readonly Exported[],
  inbound: ReadonlySet<number>,
  sessionId: string,
): Entry[] {
  const entries: Entry[] = []
  for (const row of rows) {
    const id = row.id!
    const isOut = row.sender_session === sessionId
    const isIn = inbound.has(id)
    if (!isOut && !isIn) continue
    entries.push({
      id,
      at: row.created_at ?? '',
      direction: isIn ? 'in' : 'out',
      peer: isIn ? row.sender_label || 'unknown' : row.alias || 'unknown',
      body: (row.body ?? '').slice(0, BODY_CAP),
      length: (row.body ?? '').length,
      isHuman: row.origin === 'human',
    })
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
}

/** `pager who`: NAME TOOL ROOT HOST LAST, HOST being live, gone or unknown. */
export function peersOf(run: Run): Peer[] | Failure {
  const failure = failureOf(run)
  if (failure) return { error: failure }
  const lines = run.stdout.split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) return []
  if (!/^NAME\s+TOOL\b/.test(lines[0]!)) return { error: 'unexpected who output' }
  const peers: Peer[] = []
  for (const line of lines.slice(1)) {
    const m = /^(\S+)\s+(\S+)\s+(.+?)\s+(live|gone|unknown)\s+(.+)$/.exec(line.trim())
    if (m) peers.push({ name: m[1]!, tool: m[2]!, root: m[3]!, host: m[4]!, last: m[5]!.trim() })
  }
  return peers
}

/**
 * The peers as the pane lists them: live hosts first, then the order pager gave
 * (latest activity first), the home folder shown as `~`.
 */
export function rosterOf(peers: readonly Peer[], home: string): Peer[] {
  const tilde = (root: string) =>
    // `\` too: on Windows pager prints roots as C:\Users\...
    home !== '' && (root === home || root.startsWith(`${home}/`) || root.startsWith(`${home}\\`))
      ? `~${root.slice(home.length)}`
      : root
  const live = peers.filter(peer => peer.host === 'live')
  const rest = peers.filter(peer => peer.host !== 'live')
  return [...live, ...rest].map(peer => ({ ...peer, root: tilde(peer.root) }))
}

/** The highest inbound id, the baseline a look at the pane moves to. */
export function newestOf(inbound: ReadonlySet<number>): number {
  let max = 0
  for (const id of inbound) if (id > max) max = id
  return max
}

export function newCountOf(inbound: ReadonlySet<number>, baseline: number): number {
  let count = 0
  for (const id of inbound) if (id > baseline) count += 1
  return count
}

const two = (n: number) => String(n).padStart(2, '0')

/** `2026-10-07T05:48:19.655Z` → `14:48` in the host's time zone; `--:--` for a bad time. */
export function clockOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}

/** `2026-10-07T05:48:19.655Z` → `10-07` in the host's time zone; `--` for a bad time. */
export function dayOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--'
  return `${two(date.getMonth() + 1)}-${two(date.getDate())}`
}

/** One chat of the /pager list: a peer this session has messages with. */
export type Room = {
  name: string
  /** pager's roster row for the peer; null once the peer left the roster. */
  peer: Peer | null
  /** The newest message with the peer. */
  last: Entry
}

/**
 * The chats: the conversations by their newest message, newest first. A peer
 * pager lists but this session never talked with is no room; `self` is this
 * session's name, which is the pane's header and never a room either.
 */
export function roomsOf(entries: readonly Entry[], peers: readonly Peer[], self: string): Room[] {
  const lastOf = new Map<string, Entry>()
  // Oldest first, so the last write per peer is its newest message.
  for (const entry of entries) if (entry.peer !== self) lastOf.set(entry.peer, entry)
  const peerOf = new Map(peers.map(peer => [peer.name, peer]))
  return [...lastOf.values()]
    .sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id)
    .map(last => ({ name: last.peer, peer: peerOf.get(last.peer) ?? null, last }))
}

/** How far apart two messages of one side may be and still share a sender line. */
const RUN_MS = 10 * 60_000

/**
 * The ids that open a run: the first message, a change of side, a gap past ten
 * minutes, a change of day, and `firstNew`, the message the `new` divider sits
 * above. A run draws its sender line once.
 */
export function runStartsOf(entries: readonly Entry[], firstNew: number | null): Set<number> {
  const starts = new Set<number>()
  let prev: Entry | null = null
  for (const entry of entries) {
    const gap = prev === null ? Number.NaN : Date.parse(entry.at) - Date.parse(prev.at)
    const isSameRun =
      prev !== null &&
      prev.direction === entry.direction &&
      gap <= RUN_MS &&
      dayOf(prev.at) === dayOf(entry.at) &&
      entry.id !== firstNew
    if (!isSameRun) starts.add(entry.id)
    prev = entry
  }
  return starts
}

/** The highest id of what `peer` sent this session; 0 when nothing. */
export function newestInOf(entries: readonly Entry[], peer: string): number {
  let max = 0
  for (const entry of entries) if (entry.direction === 'in' && entry.peer === peer && entry.id > max) max = entry.id
  return max
}

/**
 * The per-room seen map after a refresh: the last inbound id counted as read,
 * per peer. A room met for the first time starts at `prior`, the session's
 * baseline before this refresh moved it, so mail from before the session's
 * first look is not unread; the room `open` in the pane moves to its newest.
 */
export function seenOf(
  stored: Readonly<Record<string, number>>,
  entries: readonly Entry[],
  prior: number,
  open: string | null,
): Record<string, number> {
  const seen: Record<string, number> = { ...stored }
  for (const entry of entries) {
    if (entry.direction === 'in' && seen[entry.peer] === undefined) seen[entry.peer] = prior
  }
  if (open !== null) {
    const newest = newestInOf(entries, open)
    if (newest > (seen[open] ?? 0)) seen[open] = newest
  }
  return seen
}

/** Unread per room: what each peer sent past its seen id. Rooms with none are left out. */
export function unreadOf(entries: readonly Entry[], seen: Readonly<Record<string, number>>): Record<string, number> {
  const unread: Record<string, number> = {}
  for (const entry of entries) {
    if (entry.direction !== 'in') continue
    const mark = seen[entry.peer]
    if (mark !== undefined && entry.id > mark) unread[entry.peer] = (unread[entry.peer] ?? 0) + 1
  }
  return unread
}

/** Whether a code point takes two terminal cells (East Asian Wide and Fullwidth, emoji). */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x1fa70 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  )
}

/** Combining marks, zero-width spaces and joiners, variation selectors: no cell of their own. */
function isZeroWidth(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f)
  )
}

const cellOf = (char: string) => {
  const code = char.codePointAt(0) ?? 0
  return isZeroWidth(code) ? 0 : isWide(code) ? 2 : 1
}

/** The terminal cells a string takes: a Hangul syllable two, a Latin letter one. */
export function cellsOf(text: string): number {
  let cells = 0
  for (const char of text) cells += cellOf(char)
  return cells
}

/** A message folds past this many visual lines. */
export const FOLD_LINES = 8

/** What a folded message draws: `text`, and how many visual lines it leaves out (0 when whole). */
export type Fold = { text: string; hidden: number }

/**
 * The cells of `line` that fit in `left`, given back at the last space when
 * that costs less than a row of `room`: a Korean 어절, like a word, is not
 * split, while a long unspaced string (a path, a URL) keeps its eight rows.
 */
function cutAt(line: string, left: number, room: number): string {
  let cut = ''
  let cells = 0
  for (const char of line) {
    if (cells + cellOf(char) > left) break
    cut += char
    cells += cellOf(char)
  }
  const space = cut.lastIndexOf(' ')
  if (space <= 0) return cut
  return cells - cellsOf(cut.slice(0, space)) <= room ? cut.slice(0, space) : cut
}

/**
 * The first `limit` visual lines of `body` at `width` cells a line. A line of
 * the body takes ceil(cells / width) rows, one when empty; a line cut at the
 * fold keeps the words that fit. A folded text ends in `…`, and a code fence
 * it leaves open is closed, so the Markdown it is drawn as ends where it does.
 */
export function foldOf(body: string, width: number, limit = FOLD_LINES): Fold {
  const room = Math.max(1, width)
  const lines = body.split('\n')
  const rowsOf = (line: string) => Math.max(1, Math.ceil(cellsOf(line) / room))
  const total = lines.reduce((sum, line) => sum + rowsOf(line), 0)
  if (total <= limit) return { text: body, hidden: 0 }
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const rows = rowsOf(line)
    if (used + rows <= limit) {
      kept.push(line)
      used += rows
      continue
    }
    const left = (limit - used) * room
    if (left > 0) kept.push(cutAt(line, left, room))
    break
  }
  const text = `${kept.join('\n').trimEnd()}…`
  const fences = kept.filter(line => /^\s*(```|~~~)/.test(line))
  // An odd count leaves one open: close it with its own kind, the last fence kept.
  const open = fences.at(-1)?.trim().slice(0, 3) ?? '```'
  return { text: fences.length % 2 === 1 ? `${text}\n${open}` : text, hidden: total - limit }
}

/** Peers other than `self` whose host pager judges live. */
export function liveOf(peers: readonly Peer[], self: string): number {
  return peers.filter(peer => peer.host === 'live' && peer.name !== self).length
}

/** How long before `nowMs` an ISO time was: `now`, `12m`, `3h`, `2d`. */
export function agoOf(iso: string, nowMs: number): string | null {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return null
  const minutes = Math.floor(Math.max(0, nowMs - then) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (24 * 60))}d`
}
