/** One message of this session's pager conversation, oldest first. */
export type Entry = {
  id: number
  at: string
  direction: 'in' | 'out'
  peer: string
  body: string
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
  error: string | null
}

export type Tab = 'messages' | 'peers'

declare module 'claude-code' {
  interface PluginState {
    'pager-view': {
      pager: PagerState
      tab: Tab
    }
  }
}
