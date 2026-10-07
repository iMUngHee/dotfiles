// Laid-out graph → rows of styled runs the graph Client draws as Text. Edges first,
// then nodes over them, so a node's marker and label always win a shared cell.

import type { Positions, Size } from './layout'
import type { GraphEdge, GraphNode } from './plan'

export type Tone =
  | 'blank'
  | 'task-edge'
  | 'dependency-edge'
  | 'order-edge'
  | 'task'
  | 'eligible'
  | 'blocked'
  | 'current'
  | 'hovered'
  | 'selected'

export type Run = { text: string; tone: Tone }

const EDGE: Record<GraphEdge['kind'], { ch: string; tone: Tone }> = {
  task: { ch: '·', tone: 'task-edge' },
  dependency: { ch: '•', tone: 'dependency-edge' },
  order: { ch: '∙', tone: 'order-edge' },
}

function cellOf(point: { x: number; y: number }) {
  return { x: Math.round(point.x), y: Math.round(point.y) }
}

function markerOf(node: GraphNode, isSelected: boolean): string {
  if (isSelected) return '◉'
  return node.state === 'task' ? '◆' : '●'
}

/** Where a node's marker sits and which cells its label took (`from`..`to`, inclusive). */
export type Placement = { x: number; y: number; from: number; to: number; text: string }

/**
 * Markers first, then each label in node order: right of its marker, else left,
 * else cut with `…` into the free cells on the right. A label keeps one blank
 * cell from any other marker or label, so two never read as one.
 */
export function placementsOf(
  nodes: readonly GraphNode[],
  pos: Positions,
  size: Size,
): Map<string, Placement> {
  const { columns, rows } = size
  const taken: boolean[][] = Array.from({ length: rows }, () => Array(columns).fill(false))
  const isFree = (y: number, from: number, to: number) => {
    if (from < 0 || to >= columns) return false
    for (let cx = Math.max(0, from - 1); cx <= Math.min(columns - 1, to + 1); cx++) {
      if (taken[y]![cx]) return false
    }
    return true
  }
  const placed = new Map<string, Placement>()
  for (const node of nodes) {
    const p = pos[node.id]
    if (!p) continue
    const { x, y } = cellOf(p)
    if (x < 0 || y < 0 || x >= columns || y >= rows) continue
    taken[y]![x] = true
    placed.set(node.id, { x, y, from: x, to: x - 1, text: '' })
  }
  for (const node of nodes) {
    const place = placed.get(node.id)
    if (!place) continue
    const { x, y } = place
    const length = node.label.length
    // The marker's own cell is not an obstacle to its label's gap.
    taken[y]![x] = false
    let chosen: Placement | null = null
    if (isFree(y, x + 2, x + 1 + length)) {
      chosen = { x, y, from: x + 2, to: x + 1 + length, text: node.label }
    } else if (isFree(y, x - 1 - length, x - 2)) {
      chosen = { x, y, from: x - 1 - length, to: x - 2, text: node.label }
    } else {
      let room = 0
      while (x + 2 + room < columns && isFree(y, x + 2, x + 2 + room)) room += 1
      if (room >= 2) {
        chosen = { x, y, from: x + 2, to: x + 1 + room, text: `${node.label.slice(0, room - 1)}…` }
      }
    }
    taken[y]![x] = true
    if (!chosen) continue
    for (let cx = chosen.from; cx <= chosen.to; cx++) taken[y]![cx] = true
    placed.set(node.id, chosen)
  }
  return placed
}

export function rasterOf(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  pos: Positions,
  size: Size,
  selected: string | null = null,
  hovered: string | null = null,
): Run[][] {
  const { columns, rows } = size
  const ch: string[][] = Array.from({ length: rows }, () => Array(columns).fill(' '))
  const tone: Tone[][] = Array.from({ length: rows }, () => Array(columns).fill('blank'))
  const put = (x: number, y: number, c: string, t: Tone) => {
    if (x < 0 || y < 0 || x >= columns || y >= rows) return
    ch[y]![x] = c
    tone[y]![x] = t
  }
  for (const edge of edges) {
    const a = pos[edge.from]
    const b = pos[edge.to]
    if (!a || !b) continue
    const style = EDGE[edge.kind]
    let { x: x0, y: y0 } = cellOf(a)
    const { x: x1, y: y1 } = cellOf(b)
    const dx = Math.abs(x1 - x0)
    const dy = -Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      put(x0, y0, style.ch, style.tone)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x0 += sx
      }
      if (e2 <= dx) {
        err += dx
        y0 += sy
      }
    }
  }
  const placed = placementsOf(nodes, pos, size)
  for (const node of nodes) {
    const place = placed.get(node.id)
    if (!place) continue
    const t: Tone = node.id === selected ? 'selected' : node.id === hovered ? 'hovered' : node.state
    put(place.x, place.y, markerOf(node, node.id === selected), t)
    if (place.text === '') continue
    // The gap cell between marker and label takes the node's tone, so a picked
    // node inverts as one piece.
    const from = Math.min(place.from, place.x + 1)
    const to = Math.max(place.to, place.x - 1)
    for (let cx = from; cx <= to; cx++) {
      const at = cx - place.from
      const c = cx >= place.from && cx <= place.to ? place.text[at]! : ' '
      if (cx !== place.x) put(cx, place.y, c, t)
    }
  }
  return ch.map((line, y) => {
    const runs: Run[] = []
    for (let x = 0; x < line.length; x++) {
      const t = tone[y]![x]!
      const last = runs.at(-1)
      if (last && last.tone === t) last.text += line[x]
      else runs.push({ text: line[x]!, tone: t })
    }
    return runs
  })
}

/** The node whose marker or placed label covers a cell, the last drawn first. */
export function nodeAt(
  nodes: readonly GraphNode[],
  pos: Positions,
  size: Size,
  x: number,
  y: number,
): string | undefined {
  const placed = placementsOf(nodes, pos, size)
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!
    const place = placed.get(node.id)
    if (!place || place.y !== y) continue
    if (x === place.x) return node.id
    if (place.text !== '' && x >= Math.min(place.from, place.x) && x <= Math.max(place.to, place.x)) return node.id
  }
  return undefined
}
