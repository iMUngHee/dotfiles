import { describe, expect, test } from 'claude-code/testing'

import {
  currentOf,
  graphOf,
  groupsOf,
  hubOf,
  listingOf,
  planFile,
  resolvedOf,
  stepsOf,
} from './plan'
import type { Item, Listing } from './plan'

// A plan body in the shape the design skill writes and `pm plan-step` edits.
const PLAN = `---
id: demo
status: active
---
# Demo

## Implementation Steps

- [x] 1. 0단계: probe. PASS: validate
- [x] 2. pm-roadmap \`list --json\`. PASS: npm test
- [ ] 3. pm-band plan.ts. PASS: tests
  - [ ] a nested note that pm does not count
- [ ] 10. the last one

## Post-Implementation Notes
`

// ai/skills/pm-roadmap/ops.ts planStep, verbatim: the numbers pm checks off.
const PM_STEP = /^- \[[ x]\] (\d+)\./gm

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

const item = (over: Partial<Item> & Pick<Item, 'key' | 'id'>): Item => ({
  title: over.id,
  priority: 'P2',
  order: 0,
  plan: null,
  status: 'open',
  dependsOn: [],
  ...over,
})

describe('plan', () => {
  test('steps are the lines pm numbers, in order', () => {
    const steps = stepsOf(PLAN)
    const pm = [...PLAN.matchAll(PM_STEP)].map(m => Number(m[1]))

    expect(steps.map(step => step.n)).toEqual(pm)
    expect(steps.map(step => step.isDone)).toEqual([true, true, false, false])
    expect(steps[1]?.text).toBe('pm-roadmap `list --json`. PASS: npm test')
    expect(currentOf(steps)?.n).toBe(3)
    expect(currentOf(steps.map(step => ({ ...step, isDone: true })))).toBe(undefined)
  })

  test('the plan path joins main_root to the relative plan', () => {
    expect(planFile('/Users/u/.config', '.agents/plans/x.md')).toBe(
      '/Users/u/.config/.agents/plans/x.md',
    )
    expect(planFile('/r/', './.agents/plans/x.md')).toBe('/r/.agents/plans/x.md')
    expect(planFile('/r', '/abs/x.md')).toBe('/abs/x.md')
  })

  test('the resolver reads as plan, none, hidden or error', () => {
    const bound = ok(
      JSON.stringify({
        status: 'ok',
        plan: '.agents/plans/x.md',
        plan_status: 'active',
        id: 'x',
        title: 'X plan',
        main_root: '/r',
      }),
    )
    expect(resolvedOf(bound)).toEqual({
      kind: 'plan',
      status: 'active',
      id: 'x',
      title: 'X plan',
      plan: '.agents/plans/x.md',
      mainRoot: '/r',
    })
    expect(resolvedOf(ok('{"status":"unbound","main_root":"/r"}'))).toEqual({
      kind: 'none',
      mainRoot: '/r',
    })
    // A terminal plan and the error statuses keep main_root: the backlog is
    // read in that checkout whether or not a plan is current there.
    expect(
      resolvedOf(ok('{"status":"terminal","plan_status":"done","main_root":"/r"}')),
    ).toEqual({ kind: 'hidden', mainRoot: '/r' })
    expect(
      resolvedOf(ok('{"status":"ok","plan_status":"done","main_root":"/r"}')),
    ).toEqual({ kind: 'hidden', mainRoot: '/r' })
    expect(resolvedOf(ok('{"status":"missing_worktree","main_root":"/r"}'))).toEqual({
      kind: 'error',
      reason: 'missing_worktree',
      mainRoot: '/r',
    })
    // The three the resolver never answered: no root to report.
    expect(
      resolvedOf({ exitCode: 1, stdout: '', stderr: 'fatal: not a git repository' }),
    ).toEqual({ kind: 'hidden', mainRoot: '' })
    expect(resolvedOf({ exitCode: 2, stdout: '', stderr: 'boom\n' })).toEqual({
      kind: 'error',
      reason: 'boom',
      mainRoot: '',
    })
    expect(resolvedOf({ ...bound, isStdoutTruncated: true })).toEqual({
      kind: 'error',
      reason: 'output truncated',
      mainRoot: '',
    })
    expect(resolvedOf(ok('not json'))).toEqual({
      kind: 'error',
      reason: 'unreadable resolver output',
      mainRoot: '',
    })
  })

  test('the listing reads pm list --json, or says why not', () => {
    const listing: Listing = { eligible: [item({ key: 'A', id: 'a' })], blocked: [], inbox: 2 }
    expect(listingOf(ok(JSON.stringify(listing)))).toEqual(listing)
    expect(listingOf(ok('## Eligible (next candidates)'))).toEqual({
      error: 'unreadable list output',
    })
    expect(listingOf(ok('{"eligible":1}'))).toEqual({ error: 'unexpected list output' })
  })

  test('the backlog groups by task, ranks, and marks blocked and current', () => {
    const listing: Listing = {
      eligible: [
        item({ key: 'B', id: 'b-low', priority: 'P3' }),
        item({ key: 'A', id: 'a-2', order: 2 }),
        item({ key: 'A', id: 'a-1', order: 1, plan: '.agents/plans/a1.md' }),
        item({ key: 'B', id: 'b-high', priority: 'P0' }),
      ],
      blocked: [
        item({ key: 'A', id: 'a-dep', blockedBy: 'a-1', blockedByReason: 'dependency', dependsOn: ['a-1'] }),
      ],
      inbox: 0,
    }
    const groups = groupsOf(listing, '.agents/plans/a1.md')

    expect(groups.map(group => group.key)).toEqual(['A', 'B'])
    expect(groups[0]?.rows.map(row => row.id)).toEqual(['a-1', 'a-2', 'a-dep'])
    expect(groups[1]?.rows.map(row => row.id)).toEqual(['b-high', 'b-low'])
    expect(groups[0]?.rows.find(row => row.id === 'a-dep')?.isBlocked).toBe(true)
    expect(groups[0]?.rows.filter(row => row.isCurrent).map(row => row.id)).toEqual(['a-1'])
  })

  test('the graph links items to hubs, dependencies and Order chains', () => {
    const listing: Listing = {
      eligible: [
        item({ key: 'A', id: 'a-1', order: 1 }),
        item({ key: 'A', id: 'a-2', order: 2 }),
        item({ key: 'B', id: 'b-1', dependsOn: ['gone', 'a-1'] }),
      ],
      blocked: [],
      inbox: 0,
    }
    const graph = graphOf(listing)

    expect(graph.nodes.map(node => node.id).sort()).toEqual(
      [hubOf('A'), hubOf('B'), 'a-1', 'a-2', 'b-1'].sort(),
    )
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'a-1', to: hubOf('A'), kind: 'task' },
        { from: 'b-1', to: 'a-1', kind: 'dependency' },
        { from: 'a-2', to: 'a-1', kind: 'order' },
      ]),
    )
    expect(graph.edges.some(edge => edge.to === 'gone')).toBe(false)
    expect(graph.more).toBe(0)
  })

  test('the graph keeps to the node cap and the props budget', () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      item({ key: 'BIG', id: `big-${i}`, title: 'x'.repeat(5000) }),
    )
    const other = item({ key: 'SMALL', id: 'small', plan: '.agents/plans/s.md' })
    const unbound = graphOf({ eligible: [...many, other], blocked: [], inbox: 0 })

    expect(unbound.nodes.length).toBeLessThanOrEqual(120)
    expect(unbound.more).toBeGreaterThan(0)
    expect(JSON.stringify(unbound).length).toBeLessThanOrEqual(60_000)
    expect(unbound.nodes.every(node => node.title.length <= 40)).toBe(true)

    const bound = graphOf(
      { eligible: [...many, other], blocked: [], inbox: 0 },
      '.agents/plans/s.md',
    )
    expect(bound.nodes.map(node => node.id)).toEqual([hubOf('SMALL'), 'small'])

    const tight = graphOf({ eligible: many, blocked: [], inbox: 0 }, undefined, 120, 2_000)
    expect(JSON.stringify(tight).length).toBeLessThanOrEqual(2_000)
    expect(tight.more).toBeGreaterThan(0)
  })
})
