export const meta = {
  name: 'rule-ab',
  description: 'A/B one instruction (rule or skill section) against tickets: does it change output size and safety?',
  whenToUse: 'Before adopting, rewriting, or deleting an always-loaded rule or a skill instruction, when "does this actually help?" has no transcript answer.',
  phases: [
    { title: 'Generate', detail: 'each ticket x with-rule|without x n runs, code returned inline' },
    { title: 'Judge', detail: 'one blind judge per ticket, condition labels stripped' },
  ],
}

// Usage:
//   Workflow({ scriptPath: "~/.config/claude/workflows/rule-ab.js", args: {
//     rule: "<the exact instruction text under test>",
//     tickets: [ { key: "short-id", brief: "the request as a user would phrase it" }, ... ],
//     runs: 2
//   }})
//
// Origin: built for the Pre-Implementation Gate A/B (907a85f), which found
// over-built 83%->0%, LOC -21%, and one safety regression that produced the
// rule's delegation clause. Method follows ponytail's published benchmark:
// real tickets containing a genuine over-build trap, n runs per arm, and a
// judge that never sees which arm produced what.
//
// Known limit: this harness only fits SELF-CONTAINED tasks. A design/planning
// instruction that depends on repo state, git, or worktrees cannot be isolated
// this way — that attempt produced 0% completion on both arms and no signal.
// Pick tickets whose deliverable is code the agent can write from the brief alone.

const RULE = (args && args.rule) || ''
const TICKETS = (args && args.tickets) || []
const RUNS = (args && args.runs) || 2

if (!RULE || !TICKETS.length) {
  return { error: 'args.rule and args.tickets are required. See the usage comment at the top of this script.' }
}

const OUT = {
  type: 'object',
  required: ['files', 'approach'],
  properties: {
    approach: { type: 'string', description: 'one sentence: what you built and why that shape' },
    used_native_feature: { type: 'boolean', description: 'true if you relied on a built-in platform/stdlib capability instead of hand-rolling the core mechanism' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['scores'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'meets_requirement', 'safety_ok', 'over_built', 'note'],
        properties: {
          id: { type: 'string' },
          meets_requirement: { type: 'boolean' },
          safety_ok: { type: 'boolean', description: 'input validation, accessibility and error handling are not missing in a way that would fail review — including being silently delegated to a caller that was not delivered' },
          safety_gaps: { type: 'string' },
          over_built: { type: 'boolean', description: 'hand-rolls what a native feature provides, or abstracts with a single caller' },
          note: { type: 'string' },
        },
      },
    },
    ranking_by_quality: { type: 'array', items: { type: 'string' } },
  },
}

phase('Generate')
const cells = []
for (const t of TICKETS) for (const cond of ['rule', 'base']) for (let r = 1; r <= RUNS; r++) cells.push({ t, cond, run: r })

const generated = await parallel(cells.map(c => () =>
  agent(
    `${c.cond === 'rule' ? RULE + '\n\n---\n\n' : ''}${c.t.brief}

Return the complete file contents you would actually commit. Do not write anything to disk — the files array in your response IS the deliverable.`,
    { label: `gen:${c.t.key}:${c.cond}:${c.run}`, phase: 'Generate', schema: OUT }
  ).then(r => r && ({ ...c, out: r }))
))

const ok = generated.filter(Boolean)
const loc = f => (f.content || '').split('\n').filter(l => l.trim()).length

phase('Judge')
const judged = await parallel(TICKETS.map(t => () => {
  const mine = ok.filter(c => c.t.key === t.key)
  const labelled = mine.map((c, i) => ({ id: `${t.key}-${String.fromCharCode(65 + i)}`, cell: c }))
  const body = labelled.map(l =>
    `### candidate ${l.id}\napproach: ${l.cell.out.approach}\n` +
    (l.cell.out.files || []).map(f => `--- ${f.path}\n${(f.content || '').slice(0, 6000)}`).join('\n')
  ).join('\n\n')
  return agent(
    `You are grading candidate implementations of one ticket. You do not know how any of them were produced; judge only what is in front of you.

TICKET:
${t.brief}

${body}

For each candidate decide meets_requirement, safety_ok, and over_built. Treat handing
validation or error handling to a caller that is not part of the deliverable as a safety
gap, not as leanness. Missing ARIA on a native control that already provides it is NOT a
gap. Be concrete in notes, and rank by overall quality, best first.`,
    { label: `judge:${t.key}`, phase: 'Judge', schema: VERDICT, effort: 'high' }
  ).then(v => ({
    ticket: t.key,
    labelled: labelled.map(l => ({
      id: l.id, cond: l.cell.cond, run: l.cell.run,
      loc: (l.cell.out.files || []).reduce((a, f) => a + loc(f), 0),
      files: (l.cell.out.files || []).length,
      native: !!l.cell.out.used_native_feature,
    })),
    verdict: v,
  }))
}))

const rows = []
for (const j of judged.filter(Boolean)) {
  for (const c of j.labelled) {
    const s = (j.verdict?.scores || []).find(x => x.id === c.id) || {}
    rows.push({
      ticket: j.ticket, cond: c.cond, run: c.run, loc: c.loc, files: c.files,
      meets: s.meets_requirement, safety_ok: s.safety_ok, over_built: s.over_built,
      safety_gaps: s.safety_gaps || '', note: s.note || '',
      rank: (j.verdict?.ranking_by_quality || []).indexOf(c.id) + 1,
    })
  }
}
const agg = cond => {
  const r = rows.filter(x => x.cond === cond)
  if (!r.length) return null
  const n = r.length
  return {
    n,
    mean_loc: Math.round(r.reduce((a, x) => a + x.loc, 0) / n),
    meets_pct: Math.round(100 * r.filter(x => x.meets).length / n),
    safety_ok_pct: Math.round(100 * r.filter(x => x.safety_ok).length / n),
    over_built_pct: Math.round(100 * r.filter(x => x.over_built).length / n),
    mean_rank: (r.reduce((a, x) => a + (x.rank || 0), 0) / n).toFixed(2),
  }
}

log(`rule arm: ${JSON.stringify(agg('rule'))}`)
log(`base arm: ${JSON.stringify(agg('base'))}`)

return {
  per_ticket_loc: TICKETS.map(t => ({
    ticket: t.key,
    rule: rows.filter(r => r.ticket === t.key && r.cond === 'rule').map(r => r.loc),
    base: rows.filter(r => r.ticket === t.key && r.cond === 'base').map(r => r.loc),
  })),
  rule: agg('rule'),
  base: agg('base'),
  safety_regressions: rows.filter(r => r.safety_ok === false).map(r => ({ ticket: r.ticket, cond: r.cond, gaps: r.safety_gaps })),
  rows,
}
