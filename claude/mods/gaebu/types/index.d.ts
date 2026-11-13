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
  intent?: string
  escalate_on?: string[]
  plan_ref?: string | null
  exec_root?: string | null
  version?: number
  note?: string | null
  issuer?: string
  assignee?: string
  origin_bu?: string
}

export type ScheduleItem = {
  id: string
  title: string
  stage: string
  stage_label: string
  reasons: string[]
  priority: number
  scope: string[]
  owner_bu: { runtime_id: string; team: string; id: string } | null
  owner_display: string | null
  master: { member: string; alias: string } | null
  pm_ref: { task: string; item: string; plan?: string | null } | null
  depends_on?: string[]
  hold?: { until: string } | null
  cancellation?: { reason: string } | null
  completion: { evidence: string } | null
  dispatches: { key: string; token: string; assignee: { runtime_id: string; team: string; id: string }; duty: string | null; status: string; retired?: unknown }[]
  next_action: string
}

export type ScheduleView = {
  registered: boolean
  schedule_id?: string
  path?: string
  revision?: number
  manager?: { member: string; alias: string; mode: 'commander' | 'delegated'; state: string }
  viewer?: { runtime_id: string; team: string; id: string }
  items: ScheduleItem[]
  // retired counts all archived items, including those without a tombstone.
  counts?: Record<string, number>
  error?: { reason: string; message: string }
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
  schedule?: ScheduleView | null
}

export type BoardMember = {
  id: string
  display: string
  alias?: string
  title?: string
  binding: string
  duties: CardDuty[]
  leases: string[]
}

export type BoardBu = {
  id: string
  name: string
  status: string
  head: string
  parent?: string | null
  hold?: string | null
  members: BoardMember[]
}

export type BoardTeam = {
  id: string
  name: string
  status: string
  commander: string
  bus: BoardBu[]
  schedule?: ScheduleView | null
}

export type BoardView = {
  rev: number
  /** Changes whenever anything shown changes, time-driven stages included. */
  token: string
  teams: BoardTeam[]
  user_queue: string[]
}

export type DeskHealth = {
  phase: 'loading' | 'ready' | 'not_member' | 'error' | 'stale' | 'partial'
  error: string | null
  last_success: number | null
  session: string
}

export type DeskView = {
  tab: 'overview' | 'organization' | 'detail' | 'help'
  selected: string | null
  attention: boolean
  detailOffset?: number
}

export type DeskDetail = {
  selected: string | null
  duties: CardDuty[]
  loading: boolean
  error: string | null
}

export type DeskSnapshot = {
  card: CardView | null
  board: BoardView | null
  text: string
  health: DeskHealth
}

declare module 'claude-code' {
  interface PluginState {
    gaebu: {
      view: Shaped<DeskView>
      detail: Shaped<DeskDetail>
      snapshot: Shaped<DeskSnapshot>
    }
  }
}
