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

  test('labels past the right edge are cut, not wrapped', () => {
    const rows = rasterOf(NODES, [], { '#A': { x: 10, y: 0 }, 'a-1': { x: 0, y: 2 } }, SIZE)

    expect(textOf(rows).every(line => line.length === 12)).toBe(true)
    expect(textOf(rows)[0]).toBe('          ◆ ')
  })

  test('a cell on a marker or label hits that node; elsewhere nothing', () => {
    expect(nodeAt(NODES, POS, 6, 2)).toBe('a-1')
    expect(nodeAt(NODES, POS, 10, 2)).toBe('a-1')
    expect(nodeAt(NODES, POS, 11, 2)).toBe(undefined)
    expect(nodeAt(NODES, POS, 2, 0)).toBe('#A')
    expect(nodeAt(NODES, POS, 3, 1)).toBe(undefined)
  })
})
