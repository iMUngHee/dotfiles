/** One message of this session's pager conversation, oldest first. */
export type Entry = {
  id: number
  at: string
  direction: 'in' | 'out'
  peer: string
  /** The body as sent, line breaks kept, cut at BODY_CAP characters. */
  body: string
  /** The body's full length, so a cut one can say how much is left. */
  length: number
  isHuman: boolean
}

export type Peer = { name: string; tool: string; root: string; host: string; last: string }

/**
 * What the band and the /pager pane draw, for `sessionId`. `name` null: pager
 * has no name for this session (or no pager at all), so nothing is drawn.
 * `error` says the latest refresh failed; the rest is the last good read.
 */
export type PagerState = {
  sessionId: string
  name: string | null
  entries: Entry[]
  peers: Peer[]
  newCount: number
  /** Peers other than this session whose host is live. */
  live: number
  /** How long ago the last entry was, as of the refresh that read it (`3m`). */
  lastAgo: string | null
  /** When that refresh ran (ms since the epoch): the ages the pane draws count from it. */
  now: number
  error: string | null
}

export type Tab = 'messages' | 'peers'

declare module 'claude-code' {
  interface PluginState {
    'pager-view': {
      pager: PagerState
      tab: Tab
      /** The message the reader shows; null follows the newest. */
      pick: number | null
    }
  }
}
