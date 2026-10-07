// The /pm graph tab's surface module: lays the backlog graph out on the drawing
// thread, frame by frame, and takes the pointer and keys. It has no `$`; a pick
// reaches the hooks module as `ui.message` data ({ selected }).
//
// The layout lives in a world at least as big as the region and grown with the
// node count; the region is a camera over it (`camera` is the world point at its
// top-left, `zoom` the spacing scale), so a big graph is panned, not squeezed.
// Drag a node to move it, drag empty space to pan, shift+arrows pan, + and -
// zoom, 0 fits everything.
//
// Two ways to put the cells on screen. The terminal's text is a cell grid, so
// each row is one Text. Elsewhere (the desktop) text is set in a proportional
// face and a row of spaces does not line up; there `isPlaced` puts every run of
// glyphs in its own Box at its cell (`position: absolute`), so positions hold
// whatever the face.

import type { ClientModule, ClientSurface, Color } from 'claude-code'

import { isSettled, placed, rescaled, startTemperature, tick } from './layout'
import type { Layout, Point, Positions, Size } from './layout'
import type { Graph, GraphNode } from './plan'
import { nodeAt, rasterOf } from './raster'
import type { Tone } from './raster'

/**
 * `rows`, with `isPlaced`: the rows to lay out in. The desktop sizes a Client's
 * region to what it draws rather than to its `height`, so the region it reports
 * starts at the one row of `loading…` and stays there; the hooks module names
 * the rows instead.
 */
export type GraphProps = Graph & { isPlaced?: boolean; rows?: number }

type GraphState = {
  /** The graph as last handed in, and a key of its shape to spot a new one. */
  graph: GraphProps
  shape: string
  /** The region on screen; 0 by 0 until the first layout. */
  size: Size
  /** The space the layout runs in: the region, or more for a big graph. */
  world: Size
  layout: Layout
  camera: Point
  zoom: number
  isRunning: boolean
  pinned: string[]
  drag: string | null
  /** Where a pan began: the pointer's cell and the camera then. */
  pan: { from: Point; camera: Point } | null
  selected: string | null
  /** The node under a resting pointer, drawn underlined. */
  hovered: string | null
  /** The surface the last call was handed, for the frame timer to read. */
  box: { surface: ClientSurface<GraphState> }
}

const FRAME_MS = 50
const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const
/** Cells of world each node asks for, across and down, before the world outgrows the region. */
const ROOM_ACROSS = 24
const ROOM_DOWN = 6
const PAN_STEP = { x: 8, y: 3 }

const TONE: Record<Tone, { color?: Color; dimColor?: boolean; bold?: boolean; inverse?: boolean; underline?: boolean }> = {
  blank: {},
  'task-edge': { color: 'subtle', dimColor: true },
  'dependency-edge': { color: 'warning' },
  'order-edge': { color: 'inactive' },
  task: { color: 'claude', bold: true },
  eligible: { color: 'success' },
  blocked: { color: 'warning' },
  current: { color: 'suggestion', bold: true },
  hovered: { bold: true, underline: true },
  selected: { inverse: true, bold: true },
}

const shapeOf = (graph: Graph) =>
  `${graph.nodes.map(node => `${node.id}:${node.state}`).join(',')}|${graph.edges
    .map(edge => `${edge.from}>${edge.to}:${edge.kind}`)
    .join(',')}`

// Named rows apply once the region has columns: an unmeasured (0 by 0) mount
// still waits on `loading…` rather than laying out in no width.
const sizeOf = (surface: ClientSurface<GraphState>, graph: GraphProps): Size => ({
  columns: surface.columns,
  rows: Math.max(
    0,
    (graph.isPlaced && graph.rows !== undefined && surface.columns > 0 ? graph.rows : surface.rows) -
      (graph.more > 0 ? 1 : 0),
  ),
})

const isEmpty = (size: Size) => size.columns <= 0 || size.rows <= 0

/** The world for `graph` seen through `region`: never smaller, grown with the node count. */
function worldOf(region: Size, graph: Graph): Size {
  if (isEmpty(region)) return { columns: 0, rows: 0 }
  const side = Math.sqrt(graph.nodes.length)
  return {
    columns: Math.max(region.columns, Math.ceil(side * ROOM_ACROSS)),
    rows: Math.max(region.rows, Math.ceil(side * ROOM_DOWN)),
  }
}

/** The camera that shows the middle of `world` in `region` at `zoom`. */
function centred(world: Size, region: Size, zoom: number): Point {
  return {
    x: (world.columns - region.columns / zoom) / 2,
    y: (world.rows - region.rows / zoom) / 2,
  }
}

/** World positions as the region shows them. */
function viewed(pos: Positions, camera: Point, zoom: number): Positions {
  return Object.fromEntries(
    Object.entries(pos).map(([id, p]) => [id, { x: (p.x - camera.x) * zoom, y: (p.y - camera.y) * zoom }]),
  )
}

const toWorld = (state: GraphState, x: number, y: number): Point => ({
  x: Math.min(Math.max(0, x / state.zoom + state.camera.x), Math.max(0, state.world.columns - 1)),
  y: Math.min(Math.max(0, y / state.zoom + state.camera.y), Math.max(0, state.world.rows - 1)),
})

/** A fresh or re-fitted layout for `graph` in `world`, keeping what it can of `prev`. */
function fitted(graph: Graph, world: Size, prev?: GraphState): Layout {
  const from = prev && !isEmpty(prev.world) ? rescaled(prev.layout.pos, prev.world, world) : {}
  return {
    pos: placed(graph.nodes, graph.edges, world, from),
    temperature: startTemperature(world),
  }
}

/** Zoom by `by` levels (0 keeps it), keeping the region's middle where it is. */
function zoomed(state: GraphState, by: number): GraphState {
  const at = ZOOMS.findIndex(level => level >= state.zoom)
  const zoom = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at < 0 ? ZOOMS.indexOf(1) : at) + by))]!
  const middle = {
    x: state.camera.x + state.size.columns / state.zoom / 2,
    y: state.camera.y + state.size.rows / state.zoom / 2,
  }
  return {
    ...state,
    zoom,
    camera: { x: middle.x - state.size.columns / zoom / 2, y: middle.y - state.size.rows / zoom / 2 },
  }
}

/** The largest zoom level at which every node fits the region, centred on them. */
function fit(state: GraphState): GraphState {
  const points = Object.values(state.layout.pos)
  if (points.length === 0) return state
  const left = Math.min(...points.map(p => p.x))
  const right = Math.max(...points.map(p => p.x)) + 12
  const top = Math.min(...points.map(p => p.y))
  const bottom = Math.max(...points.map(p => p.y)) + 1
  const room = Math.min(state.size.columns / Math.max(1, right - left), state.size.rows / Math.max(1, bottom - top))
  const zoom = [...ZOOMS].reverse().find(level => level <= room) ?? ZOOMS[0]
  return {
    ...state,
    zoom,
    camera: {
      x: (left + right) / 2 - state.size.columns / zoom / 2,
      y: (top + bottom) / 2 - state.size.rows / zoom / 2,
    },
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
    const world = worldOf(size, state.graph)
    const wasEmpty = isEmpty(state.size)
    surface.setState({
      ...state,
      size,
      world,
      layout: fitted(state.graph, world, state),
      camera: wasEmpty ? centred(world, size, state.zoom) : state.camera,
      isRunning: true,
    })
    return
  }
  if (!state.isRunning || isEmpty(size)) return
  const result = tick(state.graph.nodes, state.graph.edges, state.layout, state.world, new Set(state.pinned))
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

/** The node under a region cell, through the camera. */
const hitAt = (state: GraphState, x: number, y: number) =>
  nodeAt(state.graph.nodes, viewed(state.layout.pos, state.camera, state.zoom), state.size, x, y) ?? null

function started(graph: GraphProps, surface: ClientSurface<GraphState>): GraphState {
  const box = { surface }
  const size = sizeOf(surface, graph)
  const world = worldOf(size, graph)
  const state: GraphState = {
    graph,
    shape: shapeOf(graph),
    size: isEmpty(size) ? { columns: 0, rows: 0 } : size,
    world,
    layout: isEmpty(size) ? { pos: {}, temperature: 0 } : fitted(graph, world),
    camera: isEmpty(size) ? { x: 0, y: 0 } : centred(world, size, 1),
    zoom: 1,
    isRunning: !isEmpty(size),
    pinned: [],
    drag: null,
    pan: null,
    selected: null,
    hovered: null,
    box,
  }
  surface.every(FRAME_MS, () => frame(box))
  surface.onPointer(event => {
    const now = box.surface.state
    if (!now) return
    if (event.type === 'down' && event.button === 'left') {
      const id = hitAt(now, event.x, event.y)
      const picked = pick(box.surface, now, id)
      box.surface.setState(
        id === null
          ? { ...picked, pan: { from: { x: event.x, y: event.y }, camera: now.camera } }
          : { ...picked, drag: id, pinned: [...new Set([...now.pinned, id])], isRunning: true },
      )
      return
    }
    if (event.type === 'move' && now.drag !== null) {
      box.surface.setState({
        ...now,
        layout: {
          pos: { ...now.layout.pos, [now.drag]: toWorld(now, event.x, event.y) },
          temperature: Math.max(now.layout.temperature, startTemperature(now.world) / 4),
        },
        isRunning: true,
      })
      return
    }
    if (event.type === 'move' && now.pan !== null) {
      box.surface.setState({
        ...now,
        camera: {
          x: now.pan.camera.x - (event.x - now.pan.from.x) / now.zoom,
          y: now.pan.camera.y - (event.y - now.pan.from.y) / now.zoom,
        },
      })
      return
    }
    if (event.type === 'up' && (now.drag !== null || now.pan !== null)) {
      box.surface.setState({ ...now, drag: null, pan: null })
      return
    }
    const hovered =
      event.type === 'leave' ? null : event.type === 'move' && event.button === undefined ? hitAt(now, event.x, event.y) : now.hovered
    if (hovered !== now.hovered) box.surface.setState({ ...now, hovered })
  })
  surface.onKey(event => {
    const now = box.surface.state
    if (!now) return
    const dx = event.key === 'right' ? 1 : event.key === 'left' ? -1 : 0
    const dy = event.key === 'down' ? 1 : event.key === 'up' ? -1 : 0
    if (event.shift && (dx !== 0 || dy !== 0)) {
      box.surface.setState({
        ...now,
        camera: {
          x: now.camera.x + (dx * PAN_STEP.x) / now.zoom,
          y: now.camera.y + (dy * PAN_STEP.y) / now.zoom,
        },
      })
      return
    }
    if (event.key === '+' || event.key === '=') return box.surface.setState(zoomed(now, 1))
    if (event.key === '-' || event.key === '_') return box.surface.setState(zoomed(now, -1))
    if (event.key === '0') return box.surface.setState(fit(now))
    const by = dx + dy
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
      const world = isEmpty(state.size) ? state.world : worldOf(state.size, graph)
      const next: GraphState = {
        ...state,
        graph,
        shape,
        world,
        layout: isEmpty(state.size)
          ? state.layout
          : {
              pos: placed(graph.nodes, graph.edges, world, rescaled(state.layout.pos, state.world, world)),
              temperature: startTemperature(world),
            },
        isRunning: !isEmpty(state.size),
        pinned: state.pinned.filter(id => graph.nodes.some(node => node.id === id)),
        selected: graph.nodes.some(node => node.id === state!.selected) ? state.selected : null,
        hovered: null,
      }
      surface.setState(next)
      state = next
    }
  }
  if (isEmpty(state.size)) return <Text dimColor>loading…</Text>
  const rows = rasterOf(
    state.graph.nodes,
    state.graph.edges,
    viewed(state.layout.pos, state.camera, state.zoom),
    state.size,
    state.selected,
    state.hovered,
  )
  if (graph.isPlaced) {
    const runs = rows.flatMap((line, y) => {
      let x = 0
      return line.map(run => {
        const at = x
        x += run.text.length
        return { run, x: at, y }
      })
    })
    return (
      <Box flexDirection="column">
        <Box position="relative" width={state.size.columns} height={state.size.rows}>
          {runs
            .filter(({ run }) => run.tone !== 'blank')
            .map(({ run, x, y }) => (
              <Box position="absolute" left={x} top={y}>
                <Text wrap="truncate-end" {...TONE[run.tone]}>
                  {run.text}
                </Text>
              </Box>
            ))}
        </Box>
        {state.graph.more > 0 && <Text dimColor>+{state.graph.more} more</Text>}
      </Box>
    )
  }
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
