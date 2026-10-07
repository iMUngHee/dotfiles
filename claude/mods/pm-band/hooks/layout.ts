// A force-directed layout (Fruchterman–Reingold) in terminal cells, deterministic
// for a given graph and size so a test can pin its result. The graph Client runs
// one `tick` per frame until `isSettled`.

import type { GraphEdge, GraphNode } from './plan'

export type Point = { x: number; y: number }
export type Positions = Record<string, Point>
export type Size = { columns: number; rows: number }
export type Layout = { pos: Positions; temperature: number }

/** A terminal cell is about twice as tall as it is wide; forces work in square space. */
const ASPECT = 2
const COOLING = 0.9
const COLD = 0.15
const QUIET_PER_NODE = 0.02

/** mulberry32: a small seeded generator, so placement never depends on Math.random. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashOf(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value))

function inside(point: Point, size: Size): Point {
  return {
    x: clamp(point.x, 0, Math.max(0, size.columns - 1)),
    y: clamp(point.y, 0, Math.max(0, size.rows - 1)),
  }
}

export function startTemperature(size: Size): number {
  return Math.max(size.columns, size.rows * ASPECT) / 6
}

/** Positions scaled from one region size to another, as a resize asks. */
export function rescaled(pos: Positions, from: Size, to: Size): Positions {
  const sx = from.columns > 1 ? (to.columns - 1) / (from.columns - 1) : 1
  const sy = from.rows > 1 ? (to.rows - 1) / (from.rows - 1) : 1
  return Object.fromEntries(
    Object.entries(pos).map(([id, p]) => [id, inside({ x: p.x * sx, y: p.y * sy }, to)]),
  )
}

/**
 * Where each node starts: where it already was, else beside a neighbour that
 * has a place, else a spot its id seeds. Nodes no longer in the graph drop out.
 */
export function placed(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  size: Size,
  prev: Positions = {},
): Positions {
  const pos: Positions = {}
  for (const node of nodes) {
    const kept = prev[node.id]
    if (kept) pos[node.id] = inside(kept, size)
  }
  for (const node of nodes) {
    if (pos[node.id]) continue
    const rand = seeded(hashOf(node.id))
    const neighbour = edges
      .map(edge => (edge.from === node.id ? edge.to : edge.to === node.id ? edge.from : null))
      .find(id => id !== null && pos[id] !== undefined)
    const near = neighbour ? pos[neighbour] : undefined
    pos[node.id] = inside(
      near
        ? { x: near.x + (rand() - 0.5) * 6, y: near.y + (rand() - 0.5) * 3 }
        : { x: rand() * (size.columns - 1), y: rand() * (size.rows - 1) },
      size,
    )
  }
  return pos
}

/** One step of the simulation; pinned nodes (being dragged) hold still. */
export function tick(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  layout: Layout,
  size: Size,
  pinned: ReadonlySet<string> = new Set(),
): { layout: Layout; energy: number } {
  const n = nodes.length
  if (n === 0) return { layout: { ...layout, temperature: 0 }, energy: 0 }
  const area = size.columns * size.rows * ASPECT
  const k = 0.75 * Math.sqrt(area / n)
  const disp = new Map(nodes.map(node => [node.id, { x: 0, y: 0 }]))
  const at = (id: string) => {
    const p = layout.pos[id] ?? { x: 0, y: 0 }
    return { x: p.x, y: p.y * ASPECT }
  }
  for (let i = 0; i < n; i++) {
    const a = nodes[i]!
    const pa = at(a.id)
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]!
      const pb = at(b.id)
      let dx = pa.x - pb.x
      let dy = pa.y - pb.y
      if (dx === 0 && dy === 0) {
        // Two nodes on one spot: part them along a direction their indices fix.
        dx = ((i - j) % 3) * 0.1 + 0.05
        dy = ((i + j) % 2) * 0.1 - 0.05
      }
      const d = Math.max(0.01, Math.hypot(dx, dy))
      const force = (k * k) / d
      const da = disp.get(a.id)!
      const db = disp.get(b.id)!
      da.x += (dx / d) * force
      da.y += (dy / d) * force
      db.x -= (dx / d) * force
      db.y -= (dy / d) * force
    }
  }
  for (const edge of edges) {
    const da = disp.get(edge.from)
    const db = disp.get(edge.to)
    if (!da || !db) continue
    const pa = at(edge.from)
    const pb = at(edge.to)
    const dx = pa.x - pb.x
    const dy = pa.y - pb.y
    const d = Math.max(0.01, Math.hypot(dx, dy))
    const weight = edge.kind === 'order' ? 0.5 : 1
    const force = ((d * d) / k) * weight
    da.x -= (dx / d) * force
    da.y -= (dy / d) * force
    db.x += (dx / d) * force
    db.y += (dy / d) * force
  }
  const centre = { x: (size.columns - 1) / 2, y: ((size.rows - 1) / 2) * ASPECT }
  const pos: Positions = {}
  let energy = 0
  for (const node of nodes) {
    const p = at(node.id)
    if (pinned.has(node.id)) {
      pos[node.id] = layout.pos[node.id] ?? inside({ x: 0, y: 0 }, size)
      continue
    }
    const d = disp.get(node.id)!
    // A weak pull to the centre keeps separate components on screen.
    d.x += (centre.x - p.x) * 0.05 * k
    d.y += (centre.y - p.y) * 0.05 * k
    const length = Math.hypot(d.x, d.y)
    const step = length > 0 ? Math.min(length, layout.temperature) / length : 0
    const next = inside({ x: p.x + d.x * step, y: (p.y + d.y * step) / ASPECT }, size)
    const old = layout.pos[node.id] ?? next
    energy += Math.hypot(next.x - old.x, next.y - old.y)
    pos[node.id] = next
  }
  return { layout: { pos, temperature: layout.temperature * COOLING }, energy }
}

export function isSettled(layout: Layout, energy: number, nodes: number): boolean {
  return layout.temperature < COLD || energy / Math.max(1, nodes) < QUIET_PER_NODE
}

/** Runs ticks until the layout settles or `limit` ticks pass: what a test pins. */
export function settle(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  size: Size,
  limit = 400,
): { layout: Layout; ticks: number } {
  let layout: Layout = { pos: placed(nodes, edges, size), temperature: startTemperature(size) }
  for (let ticks = 1; ticks <= limit; ticks++) {
    const result = tick(nodes, edges, layout, size)
    layout = result.layout
    if (isSettled(layout, result.energy, nodes.length)) return { layout, ticks }
  }
  return { layout, ticks: limit }
}
