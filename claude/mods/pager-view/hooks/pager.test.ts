import { describe, expect, test } from 'claude-code/testing'

import {
  conversationOf,
  exportedOf,
  inboundOf,
  isMissing,
  nameOf,
  newCountOf,
  newestOf,
  peersOf,
} from './pager'

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
    expect(entries[1]?.body).toBe('my reply ⏎ with two lines')
    expect(entries[3]?.isHuman).toBe(true)
    expect(rows.some(r => r.id === 999)).toBe(false)
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

  test('a pager that is not installed is told apart from one that failed', () => {
    expect(isMissing({ exitCode: -1, stdout: '', stderr: 'spawn pager ENOENT' })).toBe(true)
    expect(isMissing({ exitCode: 1, stdout: '', stderr: 'boom' })).toBe(false)
  })
})
