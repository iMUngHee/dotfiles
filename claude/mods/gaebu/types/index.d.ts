// What the mod keeps in $.state. Shapes mirror `gaebu me --json` and
// `gaebu board --json` (docs/model.md); only the fields the mod reads.

/** The first matching row of the stage table (docs/model.md). */
export type Stage =
  | 'ended'
  | 'held'
  | 'awaiting_answer'
  | 'awaiting_acceptance'
  | 'blocked'
  | 'vacant'
  | 'working'

/** One duty as the card, `gaebu board` and MCP show it. */
export type CardDuty = {
  id: string
  status: string
  stage: Stage
  stage_label: string
  outcome: string
  scope: string[]
  done_criteria: string
  decision_rights: string
  hold?: string | null
  source?: string | null
}

export type CardView = {
  rev: number
  member: string
  alias: string
  title: string
  team: string
  bu: string
  binding: string
  chain: string[]
  superior: string | null
  duties: CardDuty[]
  peers: string[]
  leases: string[]
  escalations: string[]
  cancels: string[]
  norms: string[]
  hash: string
}

export type BoardMember = {
  id: string
  display: string
  binding: string
  duties: CardDuty[]
  leases: string[]
}

export type BoardBu = {
  id: string
  name: string
  status: string
  head: string
  hold?: string | null
  members: BoardMember[]
}

export type BoardTeam = {
  id: string
  name: string
  status: string
  commander: string
  bus: BoardBu[]
}

export type BoardView = {
  rev: number
  /** Changes whenever anything shown changes, time-driven stages included. */
  token: string
  teams: BoardTeam[]
  user_queue: string[]
}

declare module 'claude-code' {
  interface PluginState {
    gaebu: {
      card: Shaped<CardView | null>
      cardText: Shaped<string>
      board: Shaped<BoardView | null>
    }
  }
}
