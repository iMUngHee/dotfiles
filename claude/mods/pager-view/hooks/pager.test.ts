import { describe, expect, test } from 'claude-code/testing'

import {
  agoOf,
  BODY_CAP,
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
  seenOf,
  unreadOf,
} from './pager'
import type { Entry, Peer } from './pager'

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

const WHOAMI = `host:    claude pid=62833 start=1791347620397
session: sid-a (via flag)
name:    wogi
`

// The table `pager ls --session` prints, a long body cut and one wrapped.
const LS = `ID    INBOX  FROM  STATE      BODY
#149  wogi   buni  delivered  [buni → wogi] first …
#152  review buni  delivered  [buni → review] second
#160  wogi   lopu  waiting    [lopu → wogi] third line
      continues here
`

const row = (over: Record<string, unknown>) => JSON.stringify({ v: 1, origin: 'agent', ...over })

const EXPORT = [
  row({ id: 149, created_at: '2026-10-07T05:00:00.000Z', alias: 'wogi', sender_session: 'sid-buni', sender_label: 'buni', body: 'first' }),
  row({ id: 150, created_at: '2026-10-07T05:01:00.000Z', alias: 'buni', sender_session: 'sid-a', sender_label: 'wogi', body: 'my reply\nwith two lines' }),
  row({ id: 151, created_at: '2026-10-07T05:02:00.000Z', alias: 'other', sender_session: 'sid-x', sender_label: 'x', body: 'not ours' }),
  row({ id: 152, created_at: '2026-10-07T05:03:00.000Z', alias: 'review', sender_session: 'sid-buni', sender_label: 'buni', body: 'to my other name' }),
  row({ id: 160, created_at: '2026-10-07T05:04:00.000Z', alias: 'wogi', sender_session: 'sid-h', sender_label: 'gola', origin: 'human', body: 'from 대협' }),
  JSON.stringify({ v: 2, id: 999, body: 'a future row' }),
].join('\n')

const WHO = `NAME  TOOL    ROOT                         HOST  LAST
wogi  claude  /Users/u/.config             live  just now
boje  codex   /Users/u/Documents/Codex/x   gone  28m ago
`

describe('pager', () => {
  test('the name is the whoami name line, or null without one', () => {
    expect(nameOf(ok(WHOAMI))).toBe('wogi')
    expect(nameOf(ok('host: claude\nsession: sid (via flag)\n'))).toBe(null)
    expect(nameOf({ exitCode: 1, stdout: '', stderr: 'no session' })).toEqual({ error: 'no session' })
  })

  test("whoami's placeholder for an unnamed session is not a name", () => {
    // Verbatim from `pager whoami --session <unnamed id>`: the placeholder is a
    // sentence, so a reader that keeps the rest of the line draws all of it.
    const unnamed = 'host:    claude pid=1 start=2\nsession: 0-0-0-0-0 (via flag)\nname:    none — it is assigned once a hook runs with the host detected\n'
    expect(nameOf(ok(unnamed))).toBe(null)
    // A real name followed by anything else still reads as the name alone.
    expect(nameOf(ok('name:    wogi  claude  live\n'))).toBe('wogi')
  })

  test('inbound ids come from the ls ID column only, across every name', () => {
    expect([...(inboundOf(ok(LS)) as Set<number>)]).toEqual([149, 152, 160])
    expect(inboundOf(ok('nothing here\n'))).toEqual(new Set())
    expect(inboundOf(ok('ID? what\n#1 x'))).toEqual({ error: 'unexpected ls output' })
    expect(inboundOf({ exitCode: 0, stdout: LS, stderr: '', isStdoutTruncated: true })).toEqual({
      error: 'output truncated',
    })
  })

  test('the conversation is inbound by id plus what this session sent, oldest first', () => {
    const rows = exportedOf(ok(EXPORT))
    if ('error' in rows) throw new Error(rows.error)
    const inbound = inboundOf(ok(LS)) as Set<number>
    const entries = conversationOf(rows, inbound, 'sid-a')

    expect(entries.map(e => [e.id, e.direction, e.peer])).toEqual([
      [149, 'in', 'buni'],
      [150, 'out', 'buni'],
      [152, 'in', 'buni'],
      [160, 'in', 'gola'],
    ])
    expect(entries[1]?.body).toBe('my reply\nwith two lines')
    expect(entries[1]?.length).toBe('my reply\nwith two lines'.length)
    expect(flatOf(entries[1]!.body)).toBe('my reply ⏎ with two lines')
    expect(entries[3]?.isHuman).toBe(true)
    expect(rows.some(r => r.id === 999)).toBe(false)
  })

  test('a body past the cap is kept up to the cap, its full length remembered', () => {
    const long = 'ㄱ'.repeat(BODY_CAP + 500)
    const rows = exportedOf(ok(row({ id: 149, created_at: '2026-10-07T05:00:00.000Z', alias: 'wogi', sender_session: 'sid-buni', sender_label: 'buni', body: long })))
    if ('error' in rows) throw new Error(rows.error)
    const [entry] = conversationOf(rows, new Set([149]), 'sid-a')
    expect(entry?.body.length).toBe(BODY_CAP)
    expect(entry?.length).toBe(BODY_CAP + 500)
  })

  test('the roster puts live hosts first and shows the home folder as ~', () => {
    const peers = peersOf(ok(`${WHO}kiwi  codex   /Users/u  live  now
`))
    if ('error' in peers) throw new Error(peers.error)
    expect(rosterOf(peers, '/Users/u').map(peer => [peer.name, peer.root])).toEqual([
      ['wogi', '~/.config'],
      ['kiwi', '~'],
      ['boje', '~/Documents/Codex/x'],
    ])
    expect(rosterOf(peers, '/Users/uu')[0]?.root).toBe('/Users/u/.config')
  })

  test('a Windows root under the home folder shows as ~ too', () => {
    const peers = peersOf(ok(`NAME  TOOL    ROOT                     HOST  LAST
wale  claude  C:\\Users\\u\\.config      live  now
vatu  claude  C:\\Users\\uu\\x           gone  2m ago
`))
    if ('error' in peers) throw new Error(peers.error)
    expect(rosterOf(peers, 'C:\\Users\\u').map(peer => peer.root)).toEqual(['~\\.config', 'C:\\Users\\uu\\x'])
  })

  test('a broken export line is an error, not a partial conversation', () => {
    expect(exportedOf(ok(`${EXPORT}\n{not json`))).toEqual({ error: 'unreadable export line' })
  })

  test('peers read the who table', () => {
    expect(peersOf(ok(WHO))).toEqual([
      { name: 'wogi', tool: 'claude', root: '/Users/u/.config', host: 'live', last: 'just now' },
      { name: 'boje', tool: 'codex', root: '/Users/u/Documents/Codex/x', host: 'gone', last: '28m ago' },
    ])
    expect(peersOf(ok('who?\n'))).toEqual({ error: 'unexpected who output' })
  })

  test('new mail counts the inbound ids past the baseline', () => {
    const inbound = new Set([149, 152, 160])
    expect(newestOf(inbound)).toBe(160)
    expect(newestOf(new Set())).toBe(0)
    expect(newCountOf(inbound, 150)).toBe(2)
    expect(newCountOf(inbound, 160)).toBe(0)
  })

  test('ages read now, minutes, hours and days; a bad time reads null', () => {
    const at = Date.parse('2026-10-07T06:00:00.000Z')
    expect(agoOf('2026-10-07T05:59:30.000Z', at)).toBe('now')
    expect(agoOf('2026-10-07T06:00:30.000Z', at)).toBe('now')
    expect(agoOf('2026-10-07T05:48:00.000Z', at)).toBe('12m')
    expect(agoOf('2026-10-07T03:00:00.000Z', at)).toBe('3h')
    expect(agoOf('2026-10-05T06:00:00.000Z', at)).toBe('2d')
    expect(agoOf('not a time', at)).toBe(null)
  })

  test('live peers leave out this session and hosts that are gone or unknown', () => {
    const peers = peersOf(ok(`${WHO}zola  claude  /z  unknown  1h ago\nkiwi  codex   /k  live  now\n`))
    if ('error' in peers) throw new Error(peers.error)
    expect(liveOf(peers, 'wogi')).toBe(1)
    expect(liveOf(peers, 'nobody')).toBe(2)
  })

  test('a pager that is not installed is told apart from one that failed', () => {
    expect(isMissing({ exitCode: -1, stdout: '', stderr: 'spawn pager ENOENT' })).toBe(true)
    expect(isMissing({ exitCode: 1, stdout: '', stderr: 'boom' })).toBe(false)
  })
})

const entry = (id: number, direction: 'in' | 'out', peer: string): Entry => ({
  id,
  at: `2026-10-07T05:${String(id % 60).padStart(2, '0')}:00.000Z`,
  direction,
  peer,
  body: `m${id}`,
  length: `m${id}`.length,
  isHuman: false,
})

const peer = (name: string, host = 'live'): Peer => ({ name, tool: 'claude', root: `/w/${name}`, host, last: 'now' })

describe('chats', () => {
  test('the conversations come first, newest first, then the quiet peers in roster order; self is never a room', () => {
    const entries = [entry(1, 'in', 'buni'), entry(2, 'out', 'lopu'), entry(3, 'in', 'buni'), entry(4, 'in', 'gone')]
    const rooms = roomsOf(entries, [peer('wogi'), peer('lopu'), peer('kiwi'), peer('buni'), peer('zola', 'gone')], 'wogi')

    expect(rooms.map(room => [room.name, room.last?.id ?? null, room.peer?.host ?? null])).toEqual([
      ['gone', 4, null],
      ['buni', 3, 'live'],
      ['lopu', 2, 'live'],
      ['kiwi', null, 'live'],
      ['zola', null, 'gone'],
    ])
    expect(roomsOf([], [peer('wogi')], 'wogi')).toEqual([])
  })

  test('a room met first counts nothing before the prior baseline; the open room is read up to its newest', () => {
    const entries = [entry(10, 'in', 'buni'), entry(11, 'out', 'buni'), entry(12, 'in', 'buni'), entry(13, 'in', 'lopu')]

    const first = seenOf({}, entries, 10, null)
    expect(first).toEqual({ buni: 10, lopu: 10 })
    expect(unreadOf(entries, first)).toEqual({ buni: 1, lopu: 1 })

    const opened = seenOf(first, entries, 13, 'buni')
    expect(opened).toEqual({ buni: 12, lopu: 10 })
    expect(unreadOf(entries, opened)).toEqual({ lopu: 1 })
    expect(newestInOf(entries, 'buni')).toBe(12)
    expect(newestInOf(entries, 'nobody')).toBe(0)
    // A stored mark is kept, and sent messages never count.
    expect(seenOf({ buni: 12 }, entries, 0, null)).toEqual({ buni: 12, lopu: 0 })
  })

  test('cells count a Hangul syllable or jamo as two and a Latin letter as one', () => {
    expect(cellsOf('abc')).toBe(3)
    expect(cellsOf('대협')).toBe(4)
    expect(cellsOf('ㄱ')).toBe(2)
    expect(cellsOf('pm 대협 ok')).toBe(10)
    // A combining accent or a variation selector takes no cell; a transport emoji two.
    expect(cellsOf('é')).toBe(1)
    expect(cellsOf('❤️')).toBe(1)
    expect(cellsOf('\u{1f680}')).toBe(2)
  })

  test('a body folds at eight visual lines, counting wrapped rows and blank lines', () => {
    const short = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n')
    expect(foldOf(short, 30)).toEqual({ text: short.split('\n').slice(0, 8).join('\n'), hidden: 12 })

    expect(foldOf('x'.repeat(100), 30)).toEqual({ text: 'x'.repeat(100), hidden: 0 })
    expect(foldOf('a\n\n\n\n\n\n\nb', 30).hidden).toBe(0)
    expect(foldOf('a\n\n\n\n\n\n\n\nb', 30)).toEqual({ text: 'a\n\n\n\n\n\n\n', hidden: 1 })

    // 100 syllables are 200 cells: ten rows at 20 a row; the cut keeps 8 rows' worth.
    const folded = foldOf('가'.repeat(100), 20)
    expect(folded.hidden).toBe(2)
    expect(folded.text).toBe('가'.repeat(80))
  })

  test('bubble times read the host clock and the day; a bad time reads dashes', () => {
    const at = new Date(2026, 9, 7, 14, 48).toISOString()
    expect(clockOf(at)).toBe('14:48')
    expect(dayOf(at)).toBe('10-07')
    expect(clockOf('nope')).toBe('--:--')
    expect(dayOf('nope')).toBe('--')
  })
})
