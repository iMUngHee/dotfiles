import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'
import type { BoardBu, BoardView, CardDuty, CardView, DeskDetail, DeskHealth, DeskView, ScheduleItem, ScheduleView } from '../types'

export type WorkRow = {
  id: string
  title: string
  stage: string
  label: string
  owner: string
  reason: string
  next: string
  item?: ScheduleItem
  duty?: CardDuty
}

export type DeskActions = {
  tab: (tab: DeskView['tab']) => Promise<void>
  select: (id: string) => Promise<void>
  move: (delta: number) => Promise<void>
  filter: () => Promise<void>
  refresh: () => Promise<void>
}

const ATTENTION = new Set(['dispatching', 'review', 'blocked', 'vacant', 'held', 'awaiting_answer', 'awaiting_acceptance', 'unknown'])
const DUTY_RANK: Record<string, number> = { held: 0, awaiting_answer: 1, awaiting_acceptance: 2, blocked: 3, vacant: 4, working: 5, ended: 6 }

export function scheduleOf(card: CardView | null, board: BoardView | null): ScheduleView | null {
  return card?.schedule ?? board?.teams.find(team => team.name === card?.team)?.schedule ?? null
}

export function manages(card: CardView | null, schedule: ScheduleView | null): boolean {
  return card !== null && (card.superior === null || schedule?.manager?.member === card.member)
}

export function workRows(card: CardView | null, board: BoardView | null): WorkRow[] {
  if (card === null) return []
  const schedule = scheduleOf(card, board)
  const members = board?.teams.filter(team => team.name === card.team).flatMap(team => team.bus.flatMap(bu => bu.members)) ?? []
  const duties = manages(card, schedule) ? members.flatMap(member => member.duties) : card.duties
  const standalone = [...new Map(duties.map(duty => [duty.id, duty])).values()]
    .sort((a, b) => (DUTY_RANK[a.stage] ?? 7) - (DUTY_RANK[b.stage] ?? 7))
    .map(duty => ({
      id: duty.id, title: duty.outcome, stage: duty.stage, label: duty.stage_label,
      owner: members.find(member => member.id === duty.assignee || member.duties.some(d => d.id === duty.id))?.display ?? card.alias,
      reason: duty.hold ?? duty.note ?? '', next: duty.stage === 'working' ? '완료 기준을 확인하고 결과를 인계합니다' : '상태와 결정권을 확인합니다', duty,
    }))
  if (schedule?.registered) {
    const viewer = schedule.viewer
    const mine = manages(card, schedule)
      ? schedule.items
      : schedule.items.filter(item => viewer !== undefined && (
        item.master?.member === card.member && item.owner_bu?.runtime_id === viewer.runtime_id && item.owner_bu.team === viewer.team
        || item.dispatches.some(dispatch => !dispatch.retired && dispatch.status !== 'unknown'
          && dispatch.assignee.id === viewer.id && dispatch.assignee.team === viewer.team && dispatch.assignee.runtime_id === viewer.runtime_id)
      ))
    const linked = new Set(schedule.items.flatMap(item => item.dispatches.map(dispatch => dispatch.duty)))
    return [...mine.map(item => ({
      id: item.id, title: item.title, stage: item.stage, label: item.stage_label,
      owner: item.owner_display ?? item.master?.alias ?? '미배정', reason: item.reasons.join(' / '),
      next: item.next_action, item,
    })), ...standalone.filter(row => !linked.has(row.id))]
  }
  return standalone
}

export function attentionRows(rows: WorkRow[]): WorkRow[] {
  return rows.filter(row => ATTENTION.has(row.stage))
}

export function seatOf(card: CardView): string {
  return card.chain[card.chain.length - 1] ?? card.alias
}

export function countsText(card: CardView, board: BoardView | null): string {
  const schedule = scheduleOf(card, board)
  if (schedule?.registered && !schedule.error) {
    const rows = workRows(card, board)
    const waiting = attentionRows(rows).length
    const next = attentionRows(rows)[0] ?? rows[0]
    return `${manages(card, schedule) ? '일정' : '내 작업'} ${rows.length}${waiting ? ` / 판단 ${waiting}` : ''}${next?.next ? ` / ${next.next}` : ''}`
  }
  const waiting = card.duties.filter(duty => ATTENTION.has(duty.stage)).length
  return `소임 ${card.duties.length}${waiting ? ` · 대기 ${waiting}` : ''}${card.leases.length ? ` · 점유 ${card.leases.length}` : ''}${card.escalations.length ? ` · escalation ${card.escalations.length}` : ''}`
}

function healthLine(health: DeskHealth, schedule: ScheduleView | null): string | null {
  if (health.phase === 'loading') return '일정을 읽는 중입니다'
  if (health.phase === 'not_member') return '이 세션은 아직 편성되지 않았습니다'
  if (health.phase === 'error') return `[ERROR] ${health.error ?? '일정을 읽을 수 없습니다'} / r 재시도`
  if (health.phase === 'stale' || health.phase === 'partial') {
    const at = health.last_success === null ? '' : ` / 마지막 성공 ${new Date(health.last_success).toISOString().slice(11, 19)} UTC`
    return `[${health.phase.toUpperCase()}] ${health.error ?? '갱신 실패'}${at} / r 재시도`
  }
  if (schedule?.error) return `[ERROR] ${schedule.error.message} / r 재시도`
  if (schedule?.manager && schedule.manager.state !== 'bound') return `[UNKNOWN] 일정 담당 ${schedule.manager.alias}: ${schedule.manager.state} / 관측 확인 필요`
  const unknown = schedule?.items.filter(item => item.stage === 'unknown').length ?? 0
  if (unknown) return `[UNKNOWN] ${unknown}개 작업의 실행 상태를 확인할 수 없습니다 / r 다시 확인`
  return null
}

/** Parent-first traversal also keeps disconnected units visible instead of hiding them. */
function unitTree(bus: BoardBu[]): { bu: BoardBu; depth: number }[] {
  const result: { bu: BoardBu; depth: number }[] = []
  const seen = new Set<string>()
  const visit = (bu: BoardBu, depth: number) => {
    if (seen.has(bu.id)) return
    seen.add(bu.id)
    result.push({ bu, depth })
    for (const child of bus.filter(candidate => candidate.parent === bu.id)) visit(child, depth + 1)
  }
  for (const bu of bus.filter(candidate => !candidate.parent || !bus.some(parent => parent.id === candidate.parent))) visit(bu, 0)
  for (const bu of bus) visit(bu, 0)
  return result
}

export function contractFields(card: CardView | null, board: BoardView | null, view: DeskView, detail: DeskDetail): { id: string; title: string; fields: [string, string][] } {
  const teams = board?.teams.filter(team => team.name === card?.team) ?? []
  const member = teams.flatMap(team => team.bus.flatMap(bu => bu.members)).find(candidate => `member:${candidate.id}` === view.selected)
  const bu = teams.flatMap(team => team.bus).find(candidate => `bu:${candidate.id}` === view.selected)
  const selected = workRows(card, board).find(row => row.id === view.selected)
  const fields: [string, string][] = []
  const add = (label: string, value: string | null | undefined) => { if (value) fields.push([label, value]) }
  if (member) {
    add('바인딩', member.binding)
    add('소임', member.duties.map(duty => `${duty.id} ${duty.outcome}`).join('\n'))
  } else if (bu) {
    add('상위 부', bu.parent ?? '최상위 부'); add('책임자', bu.head); add('보류', bu.hold)
    add('속관', bu.members.map(candidate => candidate.display).join('\n'))
  } else if (selected) {
    add('상태', selected.label); add('책임', selected.owner); add('다음', selected.next); add('사유', selected.reason)
    add('PM', selected.item?.pm_ref ? `${selected.item.pm_ref.task} / ${selected.item.pm_ref.item}` : undefined)
    add('계획', selected.item?.pm_ref?.plan); add('선행', selected.item?.depends_on?.join(', ')); add('범위', selected.item?.scope.join(', '))
    add('증거', selected.item?.completion?.evidence); add('일정 원본', scheduleOf(card, board)?.path)
    const local = selected.duty ? [selected.duty] : teams.flatMap(team => team.bus.flatMap(unit => unit.members.flatMap(candidate => candidate.duties))).filter(duty => selected.item?.dispatches.some(dispatch => dispatch.duty === duty.id))
    const duties = [...new Map([...local, ...(detail.selected === view.selected ? detail.duties : [])].map(duty => [duty.id, duty])).values()]
    for (const duty of duties) {
      add('소임', `${duty.id} / ${duty.stage_label}${duty.version ? ` / v${duty.version}` : ''}`)
      add('의도', duty.intent); add('결과', duty.outcome); add('범위', duty.scope.join(', ')); add('완료 기준', duty.done_criteria)
      add('결정권', duty.decision_rights); add('상신 조건', duty.escalate_on?.join('\n')); add('계획', duty.plan_ref)
      add('작업 위치', duty.exec_root); add('사유·인계', duty.note); add('사용자 원문', duty.source)
    }
  }
  return { id: member?.id ?? bu?.id ?? selected?.id ?? '작업', title: member?.display ?? bu?.name ?? selected?.title ?? '선택한 항목이 더 이상 없습니다', fields }
}

export function renderDesk(
  $: EngineInterface, e: RenderInput<'Pane'>, card: CardView | null, board: BoardView | null,
  health: DeskHealth, view: DeskView, actions: DeskActions,
  detail: DeskDetail,
): RenderElement {
  const { Box, Text, Button } = $.ui.resolve(e)
  const width = Math.max(24, e.props.bodyColumns ?? 80)
  const split = e.surface === 'terminal' && width >= 118
  const schedule = scheduleOf(card, board)
  const rows = workRows(card, board)
  const visible = view.attention ? attentionRows(rows) : rows
  const selected = rows.find(row => row.id === view.selected) ?? visible[0] ?? rows[0]
  const teams = board?.teams.filter(team => team.name === card?.team) ?? []
  const line = healthLine(health, schedule)
  const rule = (label = '') => <Text color="subtle">{label ? `${label} ` : ''}{'─'.repeat(Math.max(1, Math.floor((width - label.length * 2 - 4) / 2)))}</Text>
  const field = (label: string, value: string | null | undefined, id = label) => value ? (
    <Box flexDirection="row" key={`field-${id}`}>
      <Box width={12} flexShrink={0}><Text bold color="claude">{label}</Text></Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}><Text wrap="wrap">{value}</Text></Box>
    </Box>
  ) : null
  const key = (id: string, label: string, hotkey: string, run: () => Promise<void>) => (
    <Button key={id} label={label} hotkey={hotkey} plain onPress={run} />
  )
  const controls = (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0}>
      {key('move-next', view.tab === 'detail' ? '다음 필드' : '아래', 'j', () => actions.move(1))}
      {key('move-prev', view.tab === 'detail' ? '이전 필드' : '위', 'k', () => actions.move(-1))}
      {key('filter-attention', view.attention ? '전체 보기' : '판단만', 'f', actions.filter)}
      {key('refresh', '갱신', 'r', actions.refresh)}
      {key('back', '운영으로', 'b', () => actions.tab('overview'))}
      {key('nav-help', '도움', 'h', () => actions.tab('help'))}
    </Box>
  )
  const workLine = (row: WorkRow) => (
    <Box key={`row-${row.id}`} flexDirection="column">
      <Button key={`select-${row.id}`} plain onPress={() => actions.select(row.id)} label={`${row.id} ${row.title}`}>
        <Text inverse={selected?.id === row.id} bold={selected?.id === row.id} color={row.stage === 'blocked' ? 'warning' : undefined} wrap="truncate-end">
          {`${selected?.id === row.id ? '>' : ' '} ${row.id} [${row.label}] ${row.title}`}
        </Text>
      </Button>
      {ATTENTION.has(row.stage) && row.reason ? <Text color={row.stage === 'blocked' ? 'warning' : undefined} dimColor={row.stage !== 'blocked'} wrap="truncate-end">{`  ${row.reason}`}</Text> : null}
    </Box>
  )
  const inspection = selected ? (
    <Box flexDirection="column" key="selected-inspector" flexShrink={1}>
      <Text bold color="claude">{`${selected.id} / ${selected.label}`}</Text>
      <Text bold wrap="wrap">{selected.title}</Text>
      {field('책임', selected.owner)}
      {field('다음', selected.next)}
      {field('증거', selected.item?.completion?.evidence ?? selected.duty?.note)}
      {field('PM', selected.item?.pm_ref ? `${selected.item.pm_ref.task} / ${selected.item.pm_ref.item}` : selected.duty?.plan_ref)}
      <Text dimColor>d 상세에서 전체 계약과 경로 보기</Text>
    </Box>
  ) : <Text dimColor>선택한 작업이 없습니다</Text>

  let content: RenderElement
  if (health.phase === 'loading' || health.phase === 'not_member' || health.phase === 'error' || card === null) {
    content = <Box flexDirection="column" paddingY={1}>
      <Text bold>{health.phase === 'not_member' ? '이 세션은 아직 편성되지 않았습니다' : health.phase === 'error' ? '현재 상태를 확인할 수 없습니다' : '개부 명부가 비어 있습니다. 소속과 일정을 확인합니다.'}</Text>
      <Text dimColor>{health.phase === 'not_member' ? '대협에게 편성을 요청하거나 r로 다시 확인하세요.' : 'r 갱신 / 같은 문제가 계속되면 에이전트에게 오류를 전달하세요.'}</Text>
    </Box>
  } else if (view.tab === 'help') {
    content = <Box flexDirection="column" paddingY={1}>
      <Text bold color="claude">키보드 / 조회 전용</Text>
      {field('o / g / d', '운영 / 조직 / 선택한 전체 계약')}
      {field('j / k', '작업 선택 아래 / 위; 상세는 필드 단위로 스크롤하며 긴 값은 엔진 스크롤 키로 읽기')}
      {field('f', '판단할 일만 보기 / 전체 보기')}
      {field('r / b', '선택을 유지하며 갱신 / 운영으로 돌아가기')}
      <Text wrap="wrap">편성·배정·보류·취소는 에이전트에게 요청합니다. 이 화면은 데이터를 직접 변경하지 않습니다.</Text>
      <Text dimColor>엔진의 포커스 전환·스크롤·닫기 키를 함께 사용할 수 있습니다.</Text>
    </Box>
  } else if (view.tab === 'organization') {
    content = <Box flexDirection="column" key="organization-tree">
      <Text bold color="claude">조직 / 상위 부와 하위 부</Text>
      {teams.map(team => <Box flexDirection="column" key={team.id}>
        <Text bold>{team.commander}</Text>
        {unitTree(team.bus).map(({ bu, depth }) => <Box flexDirection="column" key={bu.id} paddingLeft={Math.min(depth * 2, 16)}>
          <Button key={`select-bu-${bu.id}`} plain label={`${depth ? '+ ' : ''}${bu.name} [${bu.status}] / ${bu.head}`} onPress={async () => { await actions.select(`bu:${bu.id}`); await actions.tab('detail') }} />
          {bu.hold ? <Text color="warning">{`보류 / ${bu.hold}`}</Text> : null}
          {bu.members.map(member => <Box flexDirection="column" key={member.id} paddingLeft={2}>
            <Button key={`select-member-${member.id}`} label={member.display} plain onPress={async () => { await actions.select(`member:${member.id}`); await actions.tab('detail') }} />
            <Text dimColor color={member.binding === 'pending' || member.binding === 'vacant' ? 'warning' : undefined}>{`${member.binding} / 소임 ${member.duties.length}${member.binding === 'pending' ? ' / 확정 대기' : member.binding === 'quiet' ? ' / 관측 오래됨, 종료 아님' : ''}`}</Text>
          </Box>)}
        </Box>)}
      </Box>)}
    </Box>
  } else if (view.tab === 'detail') {
    const contract = contractFields(card, board, view, detail)
    const offset = Math.min(view.detailOffset ?? 0, Math.max(0, contract.fields.length - 1))
    content = <Box flexDirection="column" key="full-contract">
      <Text bold color="claude">{`${contract.id} / 전체 계약`}</Text>
      <Text bold wrap="wrap">{contract.title}</Text>
      {detail.selected === view.selected && detail.loading ? <Text dimColor>전체 소임 계약을 읽는 중입니다</Text> : null}
      {detail.selected === view.selected && detail.error ? <Text color="warning" wrap="wrap">{`[PARTIAL] 소임 조회 실패: ${detail.error} / r 재시도`}</Text> : null}
      {contract.fields.slice(offset).map(([label, value], index) => field(label, value, `${offset + index}`))}
      {contract.fields.length ? <Text dimColor>{`필드 ${offset + 1}/${contract.fields.length} / j 다음, k 이전 / 긴 값은 엔진 스크롤`}</Text> : null}
    </Box>
  } else if (schedule?.registered && schedule.error && rows.length === 0) {
    content = <Box flexDirection="column" paddingY={1}><Text bold>현재 일정은 확인할 수 없습니다</Text><Text wrap="wrap">{schedule.error.message}</Text><Text dimColor>r 갱신 / 오류를 에이전트에게 전달하세요</Text></Box>
  } else {
    const ordered = [...attentionRows(visible), ...visible.filter(row => !ATTENTION.has(row.stage))]
    const budget = Math.max(2, (e.props.scroll?.bodyRows ?? 30) - (split ? 16 : 12))
    const selectedIndex = Math.max(0, ordered.findIndex(row => row.id === selected?.id))
    let start = 0
    let cost = 0
    for (let index = 0; index <= selectedIndex; index += 1) {
      cost += 1 + (ATTENTION.has(ordered[index]?.stage) && ordered[index]?.reason ? 1 : 0)
      while (cost > budget && start < index) {
        cost -= 1 + (ATTENTION.has(ordered[start].stage) && ordered[start].reason ? 1 : 0)
        start += 1
      }
    }
    const shown: WorkRow[] = []
    cost = 0
    for (const row of ordered.slice(start)) {
      const next = 1 + (ATTENTION.has(row.stage) && row.reason ? 1 : 0)
      if (cost + next > budget) break
      shown.push(row); cost += next
    }
    const attention = attentionRows(shown)
    const rest = shown.filter(row => !ATTENTION.has(row.stage))
    const queue = <Box flexDirection="column" flexGrow={1} flexShrink={1} key="attention-queue">
      <Text bold color="claude">{manages(card, schedule) ? '01  지금 판단할 일' : '01  내 작업과 다음 행동'}</Text>
      {attention.length ? attention.map(workLine) : <Text dimColor>지금 응답할 판단이 없습니다</Text>}
      {rest.length ? <Box flexDirection="column" marginTop={1}><Text bold color="claude">02  진행과 다음 배정</Text>{rest.map(workLine)}</Box> : null}
      {ordered.length > shown.length ? <Text dimColor>{`작업 ${start + 1}-${start + shown.length}/${ordered.length} / j,k로 나머지 보기`}</Text> : null}
      {visible.length === 0 ? <Text dimColor>{view.attention ? '판단 대기 항목이 없습니다. f 전체 보기' : schedule?.registered ? '아직 배정할 작업이 없습니다' : '등록된 일정이 없습니다. 에이전트에게 일정 등록을 요청하세요.'}</Text> : null}
      {split ? teams.map(team => <Box flexDirection="column" key={team.id} marginTop={1}>
        <Text bold color="claude">03  조직 맥락</Text><Text dimColor>{`${team.commander} / ${team.bus.map(bu => bu.name).join(' / ')}`}</Text>
      </Box>) : null}
    </Box>
    content = split ? <Box flexDirection="row" gap={1} key="operations-split">
      <Box flexDirection="column" width="60%" flexShrink={1}>{queue}</Box>
      <Box width={1}><Text color="subtle">│</Text></Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>{inspection}</Box>
    </Box> : <Box flexDirection="column" key="operations-stack">{queue}{selected ? <Box flexDirection="column" marginTop={1}>
      <Text bold wrap="truncate-end">{`선택 ${selected.id} / ${selected.owner}`}</Text>
      <Text wrap="truncate-end">{`다음 / ${selected.next}`}</Text>
      <Text dimColor>d 상세: 전체 계약·계획·작업 위치·증거</Text>
    </Box> : null}</Box>
  }

  return <Box flexDirection="column" paddingX={1} width={Math.max(1, width)}>
    <Text bold color="inverseText" backgroundColor="claude">{` GAEBU / 개부  ${card?.team ?? ''}${card ? ` / ${card.alias}` : ''} `}</Text>
    <Box flexDirection="row" columnGap={2} flexWrap="wrap">
      <Button key="nav-overview" hotkey="o" plain label={view.tab === 'overview' ? '[운영]' : '운영'} autoFocus onPress={() => actions.tab('overview')} />
      <Button key="nav-organization" hotkey="g" plain label={view.tab === 'organization' ? '[조직]' : '조직'} onPress={() => actions.tab('organization')} />
      <Button key="nav-detail" hotkey="d" plain label={view.tab === 'detail' ? '[상세]' : '상세'} onPress={() => actions.tab('detail')} />
      <Text dimColor>지휘석 / 조회 전용</Text>
    </Box>
    {line && health.phase !== 'not_member' ? <Text color={health.phase === 'error' || schedule?.error ? 'error' : 'warning'} wrap="wrap">{line}</Text> : card && manages(card, schedule) && schedule?.registered ? <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
      <Text bold color="warning">{`검수 ${String(rows.filter(row => row.stage === 'review').length).padStart(2, '0')}`}</Text>
      <Text bold color="warning">{`판단 ${String(attentionRows(rows).filter(row => row.stage !== 'review').length).padStart(2, '0')}`}</Text>
      <Text bold color="success">{`준비 ${String(rows.filter(row => row.stage === 'ready').length).padStart(2, '0')}`}</Text>
      <Text bold color="claude">{`진행 ${String(rows.filter(row => row.stage === 'working').length).padStart(2, '0')}`}</Text>
      <Text dimColor>{schedule.manager ? `일정 ${schedule.manager.alias} [${schedule.manager.mode === 'delegated' ? '분리' : '겸임'}]` : '일정 담당 확인 필요'}</Text>
    </Box> : card ? <Text bold color="claude" wrap="truncate-end">{countsText(card, board)}</Text> : null}
    {rule()}
    {content}
    {board?.user_queue.length ? <Text color="warning" wrap="wrap">{`대협 대기 / ${board.user_queue.join(' / ')}`}</Text> : null}
    {rule()}
    {controls}
  </Box>
}

export function bandSummary(card: CardView | null, board: BoardView | null, health: DeskHealth): string {
  const line = healthLine(health, scheduleOf(card, board))
  if (line) return line
  return card === null ? '자리 없음' : countsText(card, board)
}
