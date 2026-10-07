export type Step = { n: number; text: string; isDone: boolean }

/** One backlog item as `pm list --json` prints it (ai/skills/pm-roadmap/join.ts Candidate). */
export type Item = {
  key: string
  id: string
  title: string
  priority: string
  order: number
  plan: string | null
  status: string
  dependsOn: string[]
  blockedBy?: string
  blockedByReason?: 'dependency' | 'order'
}

export type Listing = { eligible: Item[]; blocked: Item[]; inbox: number }

/** What the band and the steps tab draw: a bound plan, no plan, or nothing. */
export type PlanView =
  | { kind: 'plan'; status: 'draft' | 'active'; id: string; title: string; plan: string; steps: Step[] }
  | { kind: 'none' }

/**
 * The band's state. `view` is the last good read for `sessionId` (null: draw
 * nothing); `error` says the latest refresh failed and why.
 */
export type BandState = { sessionId: string; view: PlanView | null; error: string | null }

/** The backlog tab's state, read only while the /pm pane is open. */
export type BacklogState = { sessionId: string; listing: Listing | null; error: string | null }

export type Tab = 'steps' | 'backlog' | 'graph'

declare module 'claude-code' {
  interface PluginState {
    'pm-band': {
      band: BandState
      backlog: BacklogState
      tab: Tab
      selected: string | null
    }
  }
}
