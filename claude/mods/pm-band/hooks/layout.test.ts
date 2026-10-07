import { describe, expect, test } from 'claude-code/testing'

import { placed, rescaled, settle, startTemperature, tick } from './layout'
import type { GraphEdge, GraphNode } from './plan'

const node = (id: string, task = 'A'): GraphNode => ({
  id,
  label: id,
  title: id,
  task,
  state: id.startsWith('#') ? 'task' : 'eligible',
})

const NODES = [node('#A'), node('a-1'), node('a-2'), node('a-3'), node('#B', 'B'), node('b-1', 'B')]
const EDGES: GraphEdge[] = [
  { from: 'a-1', to: '#A', kind: 'task' },
  { from: 'a-2', to: '#A', kind: 'task' },
  { from: 'a-3', to: '#A', kind: 'task' },
  { from: 'b-1', to: '#B', kind: 'task' },
  { from: 'b-1', to: 'a-1', kind: 'dependency' },
  { from: 'a-3', to: 'a-2', kind: 'order' },
]
const SIZE = { columns: 60, rows: 20 }

const isInside = (p: { x: number; y: number }, size = SIZE) =>
  p.x >= 0 && p.y >= 0 && p.x <= size.columns - 1 && p.y <= size.rows - 1

describe('layout', () => {
  test('the same graph and size settle to the same places', () => {
    const one = settle(NODES, EDGES, SIZE)
    const two = settle(NODES, EDGES, SIZE)

    expect(one.layout.pos).toEqual(two.layout.pos)
  })

  test('it settles within the tick limit, every node inside the grid', () => {
    const { layout, ticks } = settle(NODES, EDGES, SIZE)

    expect(ticks).toBeLessThan(400)
    expect(Object.keys(layout.pos).sort()).toEqual(NODES.map(n => n.id).sort())
    expect(Object.values(layout.pos).every(p => isInside(p))).toBe(true)
  })

  test('connected nodes end nearer each other than unconnected ones on average', () => {
    const { layout } = settle(NODES, EDGES, SIZE)
    const gap = (a: string, b: string) =>
      Math.hypot(layout.pos[a]!.x - layout.pos[b]!.x, (layout.pos[a]!.y - layout.pos[b]!.y) * 2)
    const linked = EDGES.map(e => gap(e.from, e.to))
    const unlinked = [gap('a-2', 'b-1'), gap('a-3', '#B'), gap('#A', '#B')]
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

    expect(mean(linked)).toBeLessThan(mean(unlinked))
  })

  test('a pinned node holds still while the rest move', () => {
    const pos = placed(NODES, EDGES, SIZE)
    const layout = { pos, temperature: startTemperature(SIZE) }
    const after = tick(NODES, EDGES, layout, SIZE, new Set(['a-1'])).layout

    expect(after.pos['a-1']).toEqual(pos['a-1'])
    expect(NODES.some(n => n.id !== 'a-1' && after.pos[n.id]!.x !== pos[n.id]!.x)).toBe(true)
  })

  test('kept places survive a new graph; new nodes land near a placed neighbour', () => {
    const pos = settle(NODES, EDGES, SIZE).layout.pos
    const grown = [...NODES.filter(n => n.id !== 'a-2'), node('a-4')]
    const edges: GraphEdge[] = [...EDGES, { from: 'a-4', to: '#A', kind: 'task' }]
    const next = placed(grown, edges, SIZE, pos)

    expect(next['a-1']).toEqual(pos['a-1'])
    expect(next['a-2']).toBe(undefined)
    expect(Math.abs(next['a-4']!.x - pos['#A']!.x)).toBeLessThanOrEqual(3)
  })

  test('a resize scales places into the new grid', () => {
    const pos = settle(NODES, EDGES, SIZE).layout.pos
    const small = { columns: 30, rows: 10 }
    const scaled = rescaled(pos, SIZE, small)

    expect(Object.values(scaled).every(p => isInside(p, small))).toBe(true)
    expect(Math.abs(scaled['#A']!.x - (pos['#A']!.x * 29) / 59) < 1e-9).toBe(true)
  })
})
