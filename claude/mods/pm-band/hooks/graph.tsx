// The /pm graph tab's surface module: lays the backlog graph out on the drawing
// thread, frame by frame, and takes the pointer and keys. It has no `$`; a pick
// reaches the hooks module as `ui.message` data ({ selected }).

import type { ClientModule, ClientSurface, Color } from 'claude-code'

import { isSettled, placed, rescaled, startTemperature, tick } from './layout'
import type { Layout, Size } from './layout'
import type { Graph, GraphNode } from './plan'
import { nodeAt, rasterOf } from './raster'
import type { Tone } from './raster'

export type GraphProps = Graph

type GraphState = {
  /** The graph as last handed in, and a key of its shape to spot a new one. */
  graph: Graph
  shape: string
  /** The region the layout was made for; 0 by 0 until the first layout. */
  size: Size
  layout: Layout
  isRunning: boolean
  pinned: string[]
  drag: string | null
  selected: string | null
  /** The surface the last call was handed, for the frame timer to read. */
  box: { surface: ClientSurface<GraphState> }
}

const FRAME_MS = 50

const TONE: Record<Tone, { color?: Color; dimColor?: boolean; bold?: boolean; inverse?: boolean }> = {
  blank: {},
  'task-edge': { color: 'subtle', dimColor: true },
  'dependency-edge': { color: 'warning' },
  'order-edge': { color: 'inactive' },
  task: { color: 'claude', bold: true },
  eligible: { color: 'success' },
  blocked: { color: 'warning' },
  current: { color: 'suggestion', bold: true },
  selected: { inverse: true, bold: true },
}

const shapeOf = (graph: Graph) =>
  `${graph.nodes.map(node => `${node.id}:${node.state}`).join(',')}|${graph.edges
    .map(edge => `${edge.from}>${edge.to}:${edge.kind}`)
    .join(',')}`

const sizeOf = (surface: ClientSurface<GraphState>, graph: Graph): Size => ({
  columns: surface.columns,
  rows: Math.max(0, surface.rows - (graph.more > 0 ? 1 : 0)),
})

const isEmpty = (size: Size) => size.columns <= 0 || size.rows <= 0

/** A fresh or re-fitted layout for `graph` in `size`, keeping what it can of `prev`. */
function fitted(graph: Graph, size: Size, prev?: GraphState): Layout {
  const from = prev && !isEmpty(prev.size) ? rescaled(prev.layout.pos, prev.size, size) : {}
  return {
    pos: placed(graph.nodes, graph.edges, size, from),
    temperature: startTemperature(size),
  }
}

function frame(box: GraphState['box']): void {
  const surface = box.surface
  const state = surface.state
  if (!state) return
  const size = sizeOf(surface, state.graph)
  const isResized = size.columns !== state.size.columns || size.rows !== state.size.rows
  if (isResized) {
    if (isEmpty(size)) return
    surface.setState({ ...state, size, layout: fitted(state.graph, size, state), isRunning: true })
    return
  }
  if (!state.isRunning || isEmpty(size)) return
  const result = tick(state.graph.nodes, state.graph.edges, state.layout, size, new Set(state.pinned))
  const isDone = state.drag === null && isSettled(result.layout, result.energy, state.graph.nodes.length)
  surface.setState({ ...state, layout: result.layout, isRunning: !isDone })
}

function pick(surface: ClientSurface<GraphState>, state: GraphState, id: string | null): GraphState {
  if (id !== state.selected) surface.post({ selected: id })
  return { ...state, selected: id }
}

function step(nodes: readonly GraphNode[], current: string | null, by: number): string | null {
  if (nodes.length === 0) return null
  const at = current === null ? -1 : nodes.findIndex(node => node.id === current)
  const next = at < 0 ? (by > 0 ? 0 : nodes.length - 1) : (at + by + nodes.length) % nodes.length
  return nodes[next]!.id
}

function started(graph: Graph, surface: ClientSurface<GraphState>): GraphState {
  const box = { surface }
  const size = sizeOf(surface, graph)
  const state: GraphState = {
    graph,
    shape: shapeOf(graph),
    size: isEmpty(size) ? { columns: 0, rows: 0 } : size,
    layout: isEmpty(size) ? { pos: {}, temperature: 0 } : fitted(graph, size),
    isRunning: !isEmpty(size),
    pinned: [],
    drag: null,
    selected: null,
    box,
  }
  surface.every(FRAME_MS, () => frame(box))
  surface.onPointer(event => {
    const now = box.surface.state
    if (!now) return
    if (event.type === 'down' && event.button === 'left') {
      const id = nodeAt(now.graph.nodes, now.layout.pos, now.size, event.x, event.y) ?? null
      const picked = pick(box.surface, now, id)
      box.surface.setState(
        id === null
          ? picked
          : { ...picked, drag: id, pinned: [...new Set([...now.pinned, id])], isRunning: true },
      )
      return
    }
    if (event.type === 'move' && now.drag !== null) {
      const x = Math.min(Math.max(0, event.x), Math.max(0, now.size.columns - 1))
      const y = Math.min(Math.max(0, event.y), Math.max(0, now.size.rows - 1))
      box.surface.setState({
        ...now,
        layout: {
          pos: { ...now.layout.pos, [now.drag]: { x, y } },
          temperature: Math.max(now.layout.temperature, startTemperature(now.size) / 4),
        },
        isRunning: true,
      })
      return
    }
    if (event.type === 'up' && now.drag !== null) box.surface.setState({ ...now, drag: null })
  })
  surface.onKey(event => {
    const now = box.surface.state
    if (!now) return
    const by = event.key === 'right' || event.key === 'down' ? 1 : event.key === 'left' || event.key === 'up' ? -1 : 0
    if (by !== 0) box.surface.setState(pick(box.surface, now, step(now.graph.nodes, now.selected, by)))
  })
  return state
}

const GraphView: ClientModule<GraphProps, GraphState> = (graph, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (!state) {
    state = started(graph, surface)
    surface.setState(state)
  } else {
    state.box.surface = surface
    const shape = shapeOf(graph)
    if (shape !== state.shape) {
      const size = state.size
      const next: GraphState = {
        ...state,
        graph,
        shape,
        layout: isEmpty(size)
          ? state.layout
          : { pos: placed(graph.nodes, graph.edges, size, state.layout.pos), temperature: startTemperature(size) },
        isRunning: !isEmpty(size),
        pinned: state.pinned.filter(id => graph.nodes.some(node => node.id === id)),
        selected: graph.nodes.some(node => node.id === state!.selected) ? state.selected : null,
      }
      surface.setState(next)
      state = next
    }
  }
  if (isEmpty(state.size)) return <Text dimColor>loading…</Text>
  const rows = rasterOf(state.graph.nodes, state.graph.edges, state.layout.pos, state.size, state.selected)
  return (
    <Box flexDirection="column">
      {rows.map(runs => (
        <Text wrap="truncate-end">
          {runs.map(run => (run.tone === 'blank' ? run.text : <Text {...TONE[run.tone]}>{run.text}</Text>))}
        </Text>
      ))}
      {state.graph.more > 0 && <Text dimColor>+{state.graph.more} more</Text>}
    </Box>
  )
}

export default GraphView
