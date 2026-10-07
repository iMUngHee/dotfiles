import { describe, expect, test } from 'claude-code/testing'

import type { GraphEdge, GraphNode } from './plan'
import { nodeAt, rasterOf } from './raster'

const NODES: GraphNode[] = [
  { id: '#A', label: 'A', title: 'A', task: 'A', state: 'task' },
  { id: 'a-1', label: 'a-1', title: 'one', task: 'A', state: 'blocked' },
]
const EDGES: GraphEdge[] = [{ from: 'a-1', to: '#A', kind: 'task' }]
const POS = { '#A': { x: 0, y: 0 }, 'a-1': { x: 6, y: 2 } }
const SIZE = { columns: 12, rows: 3 }

const textOf = (rows: ReturnType<typeof rasterOf>) => rows.map(runs => runs.map(r => r.text).join(''))

describe('raster', () => {
  test('nodes draw a marker and label over the edges between them', () => {
    // Bresenham from (6,2) to (0,0); the label ' A' and marker cover its first cells.
    expect(textOf(rasterOf(NODES, EDGES, POS, SIZE))).toEqual([
      '◆ A         ',
      '  ···       ',
      '     ·● a-1 ',
    ])
  })

  test('runs carry the tone of what drew them, the selected node inverted', () => {
    const rows = rasterOf(NODES, EDGES, POS, SIZE, 'a-1')

    expect(rows[0]?.[0]).toEqual({ text: '◆ A', tone: 'task' })
    expect(rows[1]?.find(run => run.tone === 'task-edge')?.text).toBe('···')
    expect(rows[2]?.find(run => run.tone === 'selected')?.text).toBe('◉ a-1')
  })

  test('a label with no room on the right goes left of its marker', () => {
    const rows = rasterOf(NODES, [], { '#A': { x: 10, y: 0 }, 'a-1': { x: 0, y: 2 } }, SIZE)

    expect(textOf(rows).every(line => line.length === 12)).toBe(true)
    expect(textOf(rows)[0]).toBe('        A ◆ ')
  })

  test('neighbouring labels never overwrite each other: left, else cut with …', () => {
    const nodes: GraphNode[] = [
      { id: 'one', label: 'session-binding', title: '', task: 'P', state: 'eligible' },
      { id: 'two', label: 'label-overlap', title: '', task: 'P', state: 'eligible' },
      { id: 'three', label: 'omarchy', title: '', task: 'P', state: 'eligible' },
    ]
    const pos = { one: { x: 0, y: 0 }, two: { x: 6, y: 0 }, three: { x: 20, y: 1 } }
    const lines = textOf(rasterOf(nodes, [], pos, { columns: 30, rows: 2 }))

    // `two`'s marker blocks the room right of `one`, and the left edge leaves none
    // on its left: `one` is cut with … and keeps a blank cell before `two`.
    expect(lines[0]).toBe('● se… ● label-overlap         ')
    // `three` has room on the right of its marker.
    expect(lines[1]).toContain('● omarchy')
  })

  test('two labels on one row, too close for both on the right, split left and right', () => {
    const nodes: GraphNode[] = [
      { id: 'a', label: 'alpha', title: '', task: 'P', state: 'eligible' },
      { id: 'b', label: 'beta', title: '', task: 'P', state: 'eligible' },
    ]
    const pos = { a: { x: 10, y: 0 }, b: { x: 13, y: 0 } }
    const line = textOf(rasterOf(nodes, [], pos, { columns: 24, rows: 1 }))[0]!

    expect(line).toBe('    alpha ●  ● beta     ')
    expect(nodeAt(nodes, pos, { columns: 24, rows: 1 }, 4, 0)).toBe('a')
    expect(nodeAt(nodes, pos, { columns: 24, rows: 1 }, 17, 0)).toBe('b')
    expect(nodeAt(nodes, pos, { columns: 24, rows: 1 }, 12, 0)).toBe(undefined)
  })

  test('a cell on a marker or label hits that node; elsewhere nothing', () => {
    expect(nodeAt(NODES, POS, SIZE, 6, 2)).toBe('a-1')
    expect(nodeAt(NODES, POS, SIZE, 10, 2)).toBe('a-1')
    expect(nodeAt(NODES, POS, SIZE, 11, 2)).toBe(undefined)
    expect(nodeAt(NODES, POS, SIZE, 2, 0)).toBe('#A')
    expect(nodeAt(NODES, POS, SIZE, 3, 1)).toBe(undefined)
  })
})
