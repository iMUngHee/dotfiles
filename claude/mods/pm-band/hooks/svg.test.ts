import { describe, expect, test } from 'claude-code/testing'

import type { Item, Listing } from '../types'
import { graphOf } from './plan'
import type { Box } from './svg'
import { altOf, SVG_LIMIT, svgLayoutOf, svgOf } from './svg'

const item = (key: string, id: string, over: Partial<Item> = {}): Item => ({
  key,
  id,
  title: `${id} title`,
  priority: 'P2',
  order: 0,
  plan: null,
  status: 'open',
  dependsOn: [],
  ...over,
})

const listingOf = (items: Item[]): Listing => ({ eligible: items, blocked: [], inbox: 0 })

const TWO_TASKS = listingOf([
  ...Array.from({ length: 9 }, (_, i) => item('CONFIG_SKILLS', `config-item-number-${i}-with-a-long-id`)),
  ...Array.from({ length: 9 }, (_, i) =>
    item('PM_SKILLS', `pm-item-${i}`, i === 1 ? { dependsOn: ['pm-item-0'] } : i === 3 ? { order: 2 } : {}),
  ),
])

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

const anyOverlap = (labels: Box[]) =>
  labels.some((a, i) => labels.slice(i + 1).some(b => overlaps(a, b)))

describe('svg', () => {
  test('the same graph draws the same document', () => {
    const graph = graphOf(TWO_TASKS)
    expect(svgOf(graph, 'pm-item-1')).toBe(svgOf(graph, 'pm-item-1'))
    expect(svgOf(graph)).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ \d+"/)
  })

  test('every node carries a title tooltip, and links and the pick are drawn', () => {
    const graph = graphOf(TWO_TASKS)
    const svg = svgOf(graph, 'pm-item-1')
    expect(svg.match(/<title>/g)?.length).toBe(graph.nodes.length)
    expect(svg).toContain('<title>task PM_SKILLS</title>')
    expect(svg).toContain('class="dependency"')
    expect(svg).toContain('class="label picked"')
    expect(svg).toContain('prefers-color-scheme: light')
  })

  test('no two labels overlap: two tasks of nine, one task of forty', () => {
    expect(anyOverlap(svgLayoutOf(graphOf(TWO_TASKS)).labels)).toBe(false)
    const big = listingOf(Array.from({ length: 40 }, (_, i) => item('ONE', `item-${i}-${'x'.repeat(i % 25)}`)))
    expect(anyOverlap(svgLayoutOf(graphOf(big)).labels)).toBe(false)
  })

  test('titles and labels are escaped', () => {
    const graph = graphOf(listingOf([item('T', 'a<b', { title: 'x & "y"' })]))
    const svg = svgOf(graph)
    expect(svg).toContain('a&lt;b')
    expect(svg).toContain('x &amp; &quot;y&quot;')
    expect(svg).not.toContain('a<b')
  })

  test('at the node cap the document stays under the Svg limit and names what is left out', () => {
    const huge = listingOf(Array.from({ length: 300 }, (_, i) => item('ONE', `item-${i}-${'y'.repeat(30)}`)))
    const graph = graphOf(huge)
    const svg = svgOf(graph)
    expect(svg.length).toBeLessThan(SVG_LIMIT)
    expect(svg).toContain(`+${graph.more} more`)
    expect(altOf(graph)).toContain(`${graph.more} more not drawn`)
  })
})
