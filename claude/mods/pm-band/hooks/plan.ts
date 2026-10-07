// Pure readers for pm-band: what the pm CLIs print, turned into what the band, the
// /pm pane and the graph draw. Nothing here touches `$`; register.tsx does the I/O.

import type { Item, Listing, Step } from '../types'

export type { Item, Listing, Step }

/** What one `$.process.run` answered, the fields these readers look at. */
export type Run = {
  exitCode: number
  stdout: string
  stderr: string
  isStdoutTruncated?: boolean
}

// The step grammar pm owns: ai/skills/pm-roadmap/ops.ts planStep counts
// /^- \[[ x]\] (\d+)\./gm over the whole file. Keep the two in step.
const STEP_LINE = /^- \[([ x])\] (\d+)\.[ \t]*(.*)$/gm

export function stepsOf(content: string): Step[] {
  return [...content.matchAll(STEP_LINE)].map(m => ({
    n: Number(m[2]),
    text: (m[3] ?? '').trim(),
    isDone: m[1] === 'x',
  }))
}

/** The first step not done yet, which is the one being worked on. */
export function currentOf(steps: readonly Step[]): Step | undefined {
  return steps.find(step => !step.isDone)
}

/** The resolver's `plan` is relative to `main_root`; an absolute one is kept. */
export function planFile(mainRoot: string, plan: string): string {
  if (plan.startsWith('/')) return plan
  return `${mainRoot.replace(/\/+$/, '')}/${plan.replace(/^\.\//, '')}`
}

export type Resolved =
  | {
      kind: 'plan'
      status: 'draft' | 'active'
      id: string
      title: string
      plan: string
      mainRoot: string
    }
  | { kind: 'none'; mainRoot: string }
  | { kind: 'hidden' }
  | { kind: 'error'; reason: string }

function failureOf(run: Run): string | undefined {
  if (run.isStdoutTruncated) return 'output truncated'
  if (run.exitCode !== 0) {
    const line = run.stderr.trim().split('\n').at(-1) ?? ''
    return line || `exit ${run.exitCode}`
  }
  return undefined
}

/** `worktree.mjs resolve-session`: ok → plan, unbound → none, terminal or outside git → hidden. */
export function resolvedOf(run: Run): Resolved {
  if (run.exitCode !== 0 && /not a git repository/.test(run.stderr)) {
    return { kind: 'hidden' }
  }
  const failure = failureOf(run)
  if (failure) return { kind: 'error', reason: failure }
  let json: Record<string, unknown>
  try {
    json = JSON.parse(run.stdout) as Record<string, unknown>
  } catch {
    return { kind: 'error', reason: 'unreadable resolver output' }
  }
  const text = (key: string) =>
    typeof json[key] === 'string' ? (json[key] as string) : ''
  const status = text('status')
  if (status === 'unbound') return { kind: 'none', mainRoot: text('main_root') }
  if (status === 'terminal') return { kind: 'hidden' }
  if (status !== 'ok') return { kind: 'error', reason: status || 'no status' }
  const planStatus = text('plan_status')
  if (planStatus !== 'draft' && planStatus !== 'active') {
    return { kind: 'hidden' }
  }
  return {
    kind: 'plan',
    status: planStatus,
    id: text('id'),
    title: text('title') || text('id'),
    plan: text('plan'),
    mainRoot: text('main_root'),
  }
}

export function listingOf(run: Run): Listing | { error: string } {
  const failure = failureOf(run)
  if (failure) return { error: failure }
  try {
    const json = JSON.parse(run.stdout) as Partial<Listing>
    if (!Array.isArray(json.eligible) || !Array.isArray(json.blocked)) {
      return { error: 'unexpected list output' }
    }
    return {
      eligible: json.eligible,
      blocked: json.blocked,
      inbox: typeof json.inbox === 'number' ? json.inbox : 0,
    }
  } catch {
    return { error: 'unreadable list output' }
  }
}

const PRIORITY: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

function byRank(a: Item, b: Item): number {
  const priority = (PRIORITY[a.priority] ?? 9) - (PRIORITY[b.priority] ?? 9)
  if (priority !== 0) return priority
  const order = (a.order || Infinity) - (b.order || Infinity)
  if (order !== 0 && !Number.isNaN(order)) return order
  return a.id.localeCompare(b.id)
}

export type Row = Item & { isBlocked: boolean; isCurrent: boolean }
export type Group = { key: string; rows: Row[] }

/** The backlog tab: tasks in key order, items by priority then order. */
export function groupsOf(listing: Listing, currentPlan?: string): Group[] {
  const rows: Row[] = [
    ...listing.eligible.map(item => ({ ...item, isBlocked: false })),
    ...listing.blocked.map(item => ({ ...item, isBlocked: true })),
  ].map(row => ({ ...row, isCurrent: !!currentPlan && row.plan === currentPlan }))
  const keys = [...new Set(rows.map(row => row.key))].sort()
  return keys.map(key => ({
    key,
    rows: rows.filter(row => row.key === key).sort(byRank),
  }))
}

export type NodeState = 'task' | 'eligible' | 'blocked' | 'current'

export type GraphNode = {
  id: string
  label: string
  title: string
  task: string
  state: NodeState
}

export type GraphEdge = {
  from: string
  to: string
  kind: 'task' | 'dependency' | 'order'
}

export type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; more: number }

export const GRAPH_NODE_CAP = 120
export const GRAPH_PROPS_BUDGET = 60_000
const TITLE_CHARS = 40

export const hubOf = (key: string) => `#${key}`

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text
}

function build(items: readonly Row[], total: number): Graph {
  const keys = [...new Set(items.map(item => item.key))].sort()
  const ids = new Set(items.map(item => item.id))
  const nodes: GraphNode[] = [
    ...keys.map(key => ({
      id: hubOf(key),
      label: key,
      title: key,
      task: key,
      state: 'task' as const,
    })),
    ...items.map(item => ({
      id: item.id,
      label: item.id,
      title: clip(item.title, TITLE_CHARS),
      task: item.key,
      state: item.isCurrent
        ? ('current' as const)
        : item.isBlocked
          ? ('blocked' as const)
          : ('eligible' as const),
    })),
  ]
  const edges: GraphEdge[] = items.map(item => ({
    from: item.id,
    to: hubOf(item.key),
    kind: 'task',
  }))
  for (const item of items) {
    for (const dep of item.dependsOn) {
      // A dependency no longer in the backlog is resolved: pm stops blocking on it.
      if (dep !== item.id && ids.has(dep)) {
        edges.push({ from: item.id, to: dep, kind: 'dependency' })
      }
    }
  }
  for (const key of keys) {
    const chain = items
      .filter(item => item.key === key && item.order > 0)
      .sort((a, b) => a.order - b.order)
    for (let i = 1; i < chain.length; i++) {
      edges.push({ from: chain[i]!.id, to: chain[i - 1]!.id, kind: 'order' })
    }
  }
  return { nodes, edges, more: total - items.length }
}

/**
 * The graph tab's data: the current plan's task when there is one, every task
 * otherwise; at most `cap` nodes (hubs included) and `budget` characters of
 * JSON, so the Client's props stay inside the engine's bounds.
 */
export function graphOf(
  listing: Listing,
  currentPlan?: string,
  cap = GRAPH_NODE_CAP,
  budget = GRAPH_PROPS_BUDGET,
): Graph {
  const rows = groupsOf(listing, currentPlan).flatMap(group => group.rows)
  const current = rows.find(row => row.isCurrent)
  const scope = (current ? rows.filter(row => row.key === current.key) : rows).sort(
    byRank,
  )
  let picked: Row[] = []
  for (const row of scope) {
    const hubs = new Set([...picked, row].map(one => one.key)).size
    if (picked.length + 1 + hubs > cap) break
    picked.push(row)
  }
  let graph = build(picked, scope.length)
  while (picked.length > 0 && JSON.stringify(graph).length > budget) {
    picked = picked.slice(0, -1)
    graph = build(picked, scope.length)
  }
  return graph
}
