import type { BoardBu, BoardMember, BoardTeam, BoardView, CardDuty, CardView, ScheduleItem, ScheduleView } from '../types'

// CLI output crosses a process boundary. Validate the fields the UI traverses
// before publishing a snapshot, while allowing additive backend fields.
export function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function json(text: string): unknown {
  try { return JSON.parse(text) } catch { return null }
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

function ref(value: unknown): boolean {
  const entry = object(value)
  return entry !== null && ['runtime_id', 'team', 'id'].every(key => typeof entry[key] === 'string')
}

function optionalText(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string'
}

function duty(value: unknown): value is CardDuty {
  const entry = object(value)
  return entry !== null && ['id', 'status', 'stage', 'stage_label', 'outcome', 'done_criteria', 'decision_rights'].every(key => typeof entry[key] === 'string')
    && strings(entry.scope) && ['hold', 'source', 'intent', 'plan_ref', 'exec_root', 'note', 'issuer', 'assignee', 'origin_bu'].every(key => optionalText(entry[key]))
    && (entry.escalate_on === undefined || strings(entry.escalate_on))
    && (entry.version === undefined || typeof entry.version === 'number')
}

function item(value: unknown): value is ScheduleItem {
  const entry = object(value)
  if (!entry || !['id', 'title', 'stage', 'stage_label', 'next_action'].every(key => typeof entry[key] === 'string')
    || !strings(entry.reasons) || !strings(entry.scope) || typeof entry.priority !== 'number' || !optionalText(entry.owner_display)
    || (entry.owner_bu !== null && !ref(entry.owner_bu)) || !Array.isArray(entry.dispatches)) return false
  if (entry.master !== null) {
    const master = object(entry.master)
    if (!master || typeof master.member !== 'string' || typeof master.alias !== 'string') return false
  }
  if (entry.pm_ref !== null) {
    const pm = object(entry.pm_ref)
    if (!pm || typeof pm.task !== 'string' || typeof pm.item !== 'string' || !optionalText(pm.plan)) return false
  }
  if (entry.completion !== null && (!object(entry.completion) || typeof object(entry.completion)?.evidence !== 'string')) return false
  if (entry.depends_on !== undefined && !strings(entry.depends_on)) return false
  return entry.dispatches.every(value => {
    const dispatch = object(value)
    return dispatch !== null && ['key', 'token', 'status'].every(key => typeof dispatch[key] === 'string') && ref(dispatch.assignee) && optionalText(dispatch.duty)
  })
}

function schedule(value: unknown): value is ScheduleView | null | undefined {
  if (value === undefined || value === null) return true
  const entry = object(value)
  if (!entry || typeof entry.registered !== 'boolean' || !Array.isArray(entry.items) || !entry.items.every(item)) return false
  if (entry.error !== undefined) {
    const error = object(entry.error)
    if (!error || typeof error.reason !== 'string' || typeof error.message !== 'string') return false
  }
  if (entry.manager !== undefined && entry.manager !== null) {
    const manager = object(entry.manager)
    if (!manager || !['member', 'alias', 'state'].every(key => typeof manager[key] === 'string') || !['commander', 'delegated'].includes(String(manager.mode))) return false
  }
  if (entry.viewer !== undefined && !ref(entry.viewer)) return false
  return ['schedule_id', 'path'].every(key => optionalText(entry[key])) && (entry.revision === undefined || typeof entry.revision === 'number')
}

function member(value: unknown): value is BoardMember {
  const entry = object(value)
  return entry !== null && ['id', 'display', 'binding'].every(key => typeof entry[key] === 'string')
    && Array.isArray(entry.duties) && entry.duties.every(duty) && strings(entry.leases)
}

function bu(value: unknown): value is BoardBu {
  const entry = object(value)
  return entry !== null && ['id', 'name', 'status', 'head'].every(key => typeof entry[key] === 'string')
    && optionalText(entry.parent) && optionalText(entry.hold) && Array.isArray(entry.members) && entry.members.every(member)
}

function team(value: unknown): value is BoardTeam {
  const entry = object(value)
  return entry !== null && ['id', 'name', 'status', 'commander'].every(key => typeof entry[key] === 'string')
    && Array.isArray(entry.bus) && entry.bus.every(bu) && schedule(entry.schedule)
}

function card(value: unknown): value is CardView {
  const entry = object(value)
  return entry !== null && ['member', 'alias', 'title', 'team', 'bu', 'binding', 'hash'].every(key => typeof entry[key] === 'string')
    && typeof entry.rev === 'number' && optionalText(entry.superior)
    && ['chain', 'peers', 'leases', 'escalations', 'cancels', 'norms'].every(key => strings(entry[key]))
    && Array.isArray(entry.duties) && entry.duties.every(duty) && schedule(entry.schedule)
}

export function parseCard(text: string): CardView | null {
  const value = json(text)
  return card(value) ? value : null
}

export function parseBoard(text: string): BoardView | { unchanged: true } | null {
  const value = json(text)
  const entry = object(value)
  if (entry?.unchanged === true) return { unchanged: true }
  if (!entry || typeof entry.rev !== 'number' || typeof entry.token !== 'string' || !Array.isArray(entry.teams) || !entry.teams.every(team) || !strings(entry.user_queue)) return null
  return { rev: entry.rev, token: entry.token, teams: entry.teams, user_queue: entry.user_queue }
}

export function parseDuty(text: string): CardDuty | null {
  const entry = object(json(text))
  if (!entry || typeof entry.status !== 'string') return null
  const source = typeof entry.source === 'string' ? entry.source : object(entry.source)?.quote ?? null
  const normalized = { ...entry, source, stage: entry.stage ?? 'ended', stage_label: entry.stage_label ?? entry.status }
  return duty(normalized) ? normalized : null
}
