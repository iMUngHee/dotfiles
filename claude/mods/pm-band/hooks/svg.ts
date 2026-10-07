// The /pm graph tab on surfaces whose text is not a cell grid (desktop, vscode,
// mobile): the backlog graph as one SVG document. Pure and deterministic; the
// hooks module draws it with `Svg` (an isolated image: no script, so a pick
// happens in the node list the hooks draw under it).
//
// Each task is a cluster: its hub in the middle, its items in two columns, the
// first half on the right and the rest on the left, one row apart. Rows never
// share a line, so labels cannot overlap whatever the item count.

import type { Graph, GraphNode } from './plan'

export type Box = { id: string; x: number; y: number; width: number; height: number }
export type Spot = { x: number; y: number; side: 'hub' | 'right' | 'left' }
export type SvgLayout = { width: number; height: number; spots: Record<string, Spot>; labels: Box[] }

export const SVG_LIMIT = 131_072
const ROW = 20
const ARM = 96
const PAD = 16
const CLUSTER_GAP = 28
const LABEL_CHARS = 30
const CHAR_PX = 7
const HUB_CHAR_PX = 8

const clip = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, chars - 1)}…` : text)
const widthOf = (text: string, px: number) => text.length * px

const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function clustersOf(graph: Graph): { hub: GraphNode; items: GraphNode[] }[] {
  return graph.nodes
    .filter(node => node.state === 'task')
    .map(hub => ({ hub, items: graph.nodes.filter(node => node.state !== 'task' && node.task === hub.task) }))
}

export function svgLayoutOf(graph: Graph): SvgLayout {
  const clusters = clustersOf(graph)
  const labelWidth = Math.max(
    0,
    ...graph.nodes.filter(node => node.state !== 'task').map(node => widthOf(clip(node.label, LABEL_CHARS), CHAR_PX)),
  )
  const half = ARM + 10 + labelWidth
  const width = PAD * 2 + half * 2
  const centre = PAD + half
  const spots: Record<string, Spot> = {}
  const labels: Box[] = []
  let top = PAD
  for (const { hub, items } of clusters) {
    const right = items.slice(0, Math.ceil(items.length / 2))
    const left = items.slice(right.length)
    const rows = Math.max(1, right.length, left.length)
    const height = rows * ROW
    // Room above the hub for its label even when the cluster has one row.
    const block = Math.max(height, 52)
    const middle = top + block / 2
    spots[hub.id] = { x: centre, y: middle, side: 'hub' }
    const hubWidth = widthOf(hub.label, HUB_CHAR_PX)
    labels.push({ id: hub.id, x: centre - hubWidth / 2, y: middle - 26, width: hubWidth, height: 16 })
    const column = (nodes: GraphNode[], side: 'right' | 'left') => {
      const offset = (rows - nodes.length) * (ROW / 2)
      nodes.forEach((node, i) => {
        const y = middle - height / 2 + offset + i * ROW + ROW / 2
        const x = side === 'right' ? centre + ARM : centre - ARM
        spots[node.id] = { x, y, side }
        const w = widthOf(clip(node.label, LABEL_CHARS), CHAR_PX)
        labels.push({ id: node.id, x: side === 'right' ? x + 10 : x - 10 - w, y: y - 7, width: w, height: 14 })
      })
    }
    column(right, 'right')
    column(left, 'left')
    top += block + CLUSTER_GAP
  }
  const moreRow = graph.more > 0 ? ROW : 0
  return { width, height: Math.max(top - CLUSTER_GAP + PAD, 60) + moreRow, spots, labels }
}

const STYLE = `
svg{--text:#e6e6e6;--muted:#8a8a8a;--rule:#4a4a4a;--accent:#d77757;--eligible:#4eba65;--blocked:#e5b143;--current:#b1b9f9;font-family:system-ui,-apple-system,sans-serif}
@media (prefers-color-scheme: light){svg{--text:#1f1f1f;--muted:#6b6b6b;--rule:#c8c8c8;--accent:#b8532f;--eligible:#2c7a3f;--blocked:#9a6a00;--current:#4752c4}}
.task{stroke:var(--rule);stroke-width:1;fill:none}
.dependency{stroke:var(--blocked);stroke-width:1.5;fill:none}
.order{stroke:var(--muted);stroke-width:1;stroke-dasharray:3 3;fill:none}
.hub{fill:var(--accent)}
.hub-label{fill:var(--accent);font-size:13px;font-weight:600}
.label{fill:var(--text);font-size:12px}
.eligible{fill:var(--eligible)}
.blocked{fill:var(--blocked)}
.current{fill:var(--current)}
.ring{stroke:var(--current);stroke-width:2;fill:none}
.picked{font-weight:700}
.more{fill:var(--muted);font-size:12px}
g.node:hover .label{font-weight:700}
`

/** The path between two spots: a horizontal S-curve, so links fan out from a hub. */
function curve(a: Spot, b: Spot): string {
  const mid = (a.x + b.x) / 2
  return `M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`
}

export function svgOf(graph: Graph, selected: string | null = null): string {
  const layout = svgLayoutOf(graph)
  const parts: string[] = []
  for (const edge of graph.edges) {
    const a = layout.spots[edge.from]
    const b = layout.spots[edge.to]
    if (!a || !b) continue
    parts.push(`<path class="${edge.kind}" d="${curve(a, b)}"${edge.kind === 'dependency' ? ' marker-end="url(#arrow)"' : ''}/>`)
  }
  for (const node of graph.nodes) {
    const spot = layout.spots[node.id]
    if (!spot) continue
    const box = layout.labels.find(one => one.id === node.id)!
    const isPicked = node.id === selected
    const tip = escaped(node.state === 'task' ? `task ${node.task}` : `${node.label} — ${node.title}`)
    if (node.state === 'task') {
      parts.push(
        `<g class="node"><title>${tip}</title><circle class="hub" cx="${spot.x}" cy="${spot.y}" r="7"/>` +
          `<text class="hub-label${isPicked ? ' picked' : ''}" x="${spot.x}" y="${box.y + 12}" text-anchor="middle">${escaped(node.label)}</text></g>`,
      )
      continue
    }
    const anchor = spot.side === 'left' ? 'end' : 'start'
    const tx = spot.side === 'left' ? spot.x - 10 : spot.x + 10
    const ring = isPicked || node.state === 'current' ? `<circle class="ring" cx="${spot.x}" cy="${spot.y}" r="8"/>` : ''
    parts.push(
      `<g class="node"><title>${tip}</title>${ring}<circle class="${node.state}" cx="${spot.x}" cy="${spot.y}" r="4.5"/>` +
        `<text class="label${isPicked ? ' picked' : ''}" x="${tx}" y="${spot.y + 4}" text-anchor="${anchor}">${escaped(clip(node.label, LABEL_CHARS))}</text></g>`,
    )
  }
  if (graph.more > 0) {
    parts.push(`<text class="more" x="${PAD}" y="${layout.height - PAD / 2}">+${graph.more} more</text>`)
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}">` +
    `<style>${STYLE}</style>` +
    `<defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" fill="var(--blocked)"/></marker></defs>` +
    parts.join('') +
    `</svg>`
  )
}

/** What the drawing says, for a reader that cannot see it. */
export function altOf(graph: Graph): string {
  const tasks = graph.nodes.filter(node => node.state === 'task').length
  const items = graph.nodes.length - tasks
  const links = graph.edges.filter(edge => edge.kind === 'dependency').length
  return `Backlog graph: ${tasks} task${tasks === 1 ? '' : 's'}, ${items} item${items === 1 ? '' : 's'}, ${links} dependency link${links === 1 ? '' : 's'}${graph.more > 0 ? `, ${graph.more} more not drawn` : ''}`
}
