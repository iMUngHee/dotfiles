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

export function rasterOf(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  pos: Positions,
  size: Size,
  selected: string | null = null,
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
  for (const node of nodes) {
    const p = pos[node.id]
    if (!p) continue
    const { x, y } = cellOf(p)
    const isSelected = node.id === selected
    const t: Tone = isSelected ? 'selected' : node.state
    put(x, y, markerOf(node, isSelected), t)
    const label = ` ${node.label}`
    for (let i = 0; i < label.length; i++) put(x + 1 + i, y, label[i]!, t)
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

/** The node whose marker or label covers a cell, the topmost (last drawn) first. */
export function nodeAt(
  nodes: readonly GraphNode[],
  pos: Positions,
  x: number,
  y: number,
): string | undefined {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!
    const p = pos[node.id]
    if (!p) continue
    const cell = cellOf(p)
    if (cell.y === y && x >= cell.x && x <= cell.x + 1 + node.label.length) return node.id
  }
  return undefined
}
