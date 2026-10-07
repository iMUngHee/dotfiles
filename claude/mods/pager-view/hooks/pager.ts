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

/** `pager whoami --session <id>`: the `name:` line, or null when it has none. */
export function nameOf(run: Run): string | null | Failure {
  const failure = failureOf(run)
  if (failure) return { error: failure }
  const line = run.stdout.split('\n').find(one => /^name:/.test(one))
  const name = line?.replace(/^name:\s*/, '').trim()
  return name ? name : null
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
      body: (row.body ?? '').replace(/\s*\n\s*/g, ' ⏎ '),
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

/** `2026-10-07T05:48:19.655Z` → `10-07 14:48` in the host's time zone. */
export function stampOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '--:--'
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}
