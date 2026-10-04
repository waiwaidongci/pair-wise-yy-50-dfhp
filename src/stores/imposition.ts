import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  commitBaseline,
  expectedOutputHash,
  findBaseline,
  labelTime,
  nextVersionId,
  packageManifestHash,
  planShards,
  previewReuse,
  shardInputHash,
  timestamp,
  versionContentHash,
  type BaselineProposal,
  type ConflictRecord,
  type ExportTask,
  type ImpositionVersion,
  type LockOutcome,
  type MigrationRecord,
  type Page,
  type Position,
  type Proof,
  type ReconcileStat,
  type Shard,
  type Validation,
} from '../production/handoff'
import { migrateLegacy, readLegacy, seedState, STORAGE_KEY, type ProductionState } from '../production/migration'

export type {
  ConflictRecord,
  ExportTask,
  ImpositionVersion,
  MigrationRecord,
  Page,
  Position,
  Proof,
  Shard,
  Validation,
}

export const sheetSpec = {
  width: 720,
  height: 1020,
  bleed: 3,
  safe: 5,
  gutter: 6,
  binding: '骑马订',
  grain: '纵向',
}

const seedPages: Page[] = [
  { pageNo: 1, name: '封面', width: 210, height: 297, bleed: 3, content: '潮汐来信 / 节目册' },
  { pageNo: 2, name: '版权页', width: 210, height: 297, bleed: 2, content: '版权与演职人员' },
  { pageNo: 3, name: '序言', width: 210, height: 297, bleed: 3, content: '导演手记' },
  { pageNo: 4, name: '剧照跨页左', width: 210, height: 297, bleed: 3, content: '第一幕剧照' },
  { pageNo: 5, name: '剧照跨页右', width: 210, height: 297, bleed: 3, content: '第一幕剧照延伸' },
  { pageNo: 6, name: '曲目表', width: 210, height: 297, bleed: 3, content: '曲目与时长' },
  { pageNo: 7, name: '创作团队', width: 210, height: 297, bleed: 1, content: '主创与制作团队' },
  { pageNo: 8, name: '封底', width: 210, height: 297, bleed: 3, content: '巡演信息' },
]

const seedPositions: Position[] = [
  { id: 'P-01', pageNo: 8, x: 34, y: 44, rotation: 0, front: true },
  { id: 'P-02', pageNo: 1, x: 372, y: 44, rotation: 180, front: true },
  { id: 'P-03', pageNo: 6, x: 34, y: 548, rotation: 180, front: true },
  { id: 'P-04', pageNo: 3, x: 372, y: 548, rotation: 0, front: true },
  { id: 'P-05', pageNo: 2, x: 34, y: 44, rotation: 0, front: false },
  { id: 'P-06', pageNo: 7, x: 372, y: 44, rotation: 180, front: false },
  { id: 'P-07', pageNo: 4, x: 34, y: 548, rotation: 0, front: false },
  { id: 'P-08', pageNo: 5, x: 372, y: 548, rotation: 180, front: false },
]

const seedProofs: Proof[] = [
  { id: 'PRF-01', round: 1, date: '2026-09-18', sample: '数字样张 v1', deltaE: 3.8, feedback: '封面夜空蓝偏紫，剧照暗部层次压缩。', correction: '调整 CMYK 曲线，黑色通道减少 4%。', owner: '周默 / 色彩管理', decision: '退回' },
  { id: 'PRF-02', round: 2, date: '2026-09-25', sample: '数字样张 v2', deltaE: 1.9, feedback: '整体色差改善，P7 出血仍不足。', correction: '重排 P7 版位并增加 2mm 出血。', owner: '林青 / 拼版', decision: '待决定' },
]

const seedTasks = [
  { id: 'EXP-0925-01', name: '印刷交付包 · PDF/X-4', progress: 72, status: '已中断' as const, updatedAt: '09-25 16:42', resumable: true },
  { id: 'EXP-0925-02', name: '数字样张低分辨率预览', progress: 100, status: '已完成' as const, updatedAt: '09-25 15:18', resumable: false },
]

function newClientId(): string {
  return `TAB-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function bootstrapState(): ProductionState {
  // 1) 已是版本化结构：直接恢复（含分片、冲突与迁移哈希）
  const savedV2 = localStorage.getItem(STORAGE_KEY)
  if (savedV2) {
    try {
      const parsed = JSON.parse(savedV2) as ProductionState
      if (parsed.schema === 2 && Array.isArray(parsed.versions)) return parsed
    } catch {
      // 存档损坏时落到迁移/重建路径
    }
  }
  // 2) 旧扁平结构：迁移到新结构并留下源/目标哈希
  const legacy = readLegacy()
  if (legacy) {
    const migrated = migrateLegacy(legacy.data, legacy.sourceHash, { pages: seedPages, positions: seedPositions, proofs: seedProofs })
    migrated.clientLabel = '迁移后的工作区'
    return migrated
  }
  // 3) 首次使用：内置样例也走一次“升级”，留下哈希基线
  return seedState({ pages: seedPages, positions: seedPositions, proofs: seedProofs, tasks: seedTasks })
}

export const useImpositionStore = defineStore('imposition', () => {
  const initial = bootstrapState()

  const pages = ref<Page[]>(structuredClone(initial.pages))
  const positions = ref<Position[]>(structuredClone(initial.positions))
  const proofs = ref<Proof[]>(structuredClone(initial.proofs))
  const versions = ref<ImpositionVersion[]>(structuredClone(initial.versions))
  const tasks = ref<ExportTask[]>(structuredClone(initial.tasks))
  const shards = ref<Shard[]>(structuredClone(initial.shards))
  const conflicts = ref<ConflictRecord[]>([])
  const migrations = ref<MigrationRecord[]>(structuredClone(initial.migrations))
  const side = ref<'front' | 'back'>(initial.side)
  const zoom = ref(initial.zoom)
  const selectedPosition = ref<string | null>(initial.selectedPositionId)
  const selectedProof = ref<string | null>(initial.selectedProofId)
  const clientId = ref(initial.clientId)
  const clientLabel = ref(initial.clientLabel)
  const lastIncomingLock = ref<string | null>(null)
  const lastReconciliation = ref<ReconcileStat[]>([])

  const baseline = computed<ImpositionVersion | null>(() => findBaseline(versions.value))
  const revision = computed(() => baseline.value?.id ?? versions.value.at(-1)?.id ?? '—')
  const locked = computed(() => baseline.value?.status === '已锁定')
  const draftHash = computed(() => versionContentHash(pages.value, positions.value))
  const dirty = computed(() => !baseline.value || draftHash.value !== baseline.value.contentHash)
  const pendingProof = computed(() => proofs.value.find((proof) => proof.decision === '待决定'))
  const currentReuse = computed(() => previewReuse(pages.value, positions.value, tasks.value, shards.value, '印刷交付包'))

  const validations = computed<Validation[]>(() => {
    const issues: Validation[] = []
    const placedPages = positions.value.map((position) => position.pageNo)
    pages.value.forEach((page) => {
      if (!placedPages.includes(page.pageNo)) issues.push({ id: `missing-${page.pageNo}`, severity: '错误', pageNo: page.pageNo, title: `P${page.pageNo} 尚未拼版`, detail: `${page.name} 未出现在正反版位中。` })
      if (page.bleed < sheetSpec.bleed) issues.push({ id: `bleed-${page.pageNo}`, severity: '错误', pageNo: page.pageNo, title: `P${page.pageNo} 出血不足`, detail: `页面出血 ${page.bleed}mm，低于印刷要求 ${sheetSpec.bleed}mm。` })
    })
    for (let index = 0; index < positions.value.length; index += 1) {
      for (let next = index + 1; next < positions.value.length; next += 1) {
        const a = positions.value[index]
        const b = positions.value[next]
        if (a.front === b.front && Math.abs(a.x - b.x) < 320 && Math.abs(a.y - b.y) < 430) {
          issues.push({ id: `overlap-${a.id}-${b.id}`, severity: '错误', pageNo: a.pageNo, title: `${a.id} 与 ${b.id} 版位重叠`, detail: '当前纸张尺寸下页面之间不足安全间隙。' })
        }
      }
    }
    const frontOrder = positions.value.filter((item) => item.front).sort((a, b) => a.x - b.x || a.y - b.y).map((item) => item.pageNo)
    if (frontOrder[0] !== 1) issues.push({ id: 'binding-order', severity: '警告', pageNo: 1, title: '骑马订正版页序需要复核', detail: `当前首位为 P${frontOrder[0]}，装订方向规则期望封面位于首版位。` })
    return issues
  })

  function persist() {
    const state: ProductionState = {
      schema: 2,
      clientId: clientId.value,
      clientLabel: clientLabel.value,
      pages: pages.value,
      positions: positions.value,
      proofs: proofs.value,
      versions: versions.value,
      tasks: tasks.value,
      shards: shards.value,
      conflicts: conflicts.value,
      migrations: migrations.value,
      selectedProofId: selectedProof.value,
      side: side.value,
      zoom: zoom.value,
      selectedPositionId: selectedPosition.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }

  watch(
    [pages, positions, proofs, versions, tasks, shards, conflicts, migrations, side, zoom, selectedPosition, selectedProof],
    persist,
    { deep: true },
  )

  // 其他标签页锁定新版本：storage 事件广播，直接接收已确认基线并对账
  function onExternalState(event: StorageEvent) {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    let incoming: ProductionState
    try {
      incoming = JSON.parse(event.newValue) as ProductionState
    } catch {
      return
    }
    const incomingBaseline = findBaseline(incoming.versions)
    if (!incomingBaseline || incomingBaseline.id === baseline.value?.id) return
    applyIncomingBaseline(incoming, incomingBaseline)
  }

  function applyIncomingBaseline(incoming: ProductionState, incomingBaseline: ImpositionVersion) {
    const wasDifferent = versionContentHash(pages.value, positions.value) !== incomingBaseline.contentHash
    versions.value = incoming.versions
    proofs.value = incoming.proofs
    tasks.value = incoming.tasks
    shards.value = incoming.shards
    migrations.value = incoming.migrations
    conflicts.value = incoming.conflicts
    pages.value = structuredClone(incoming.pages)
    positions.value = structuredClone(incoming.positions)
    if (wasDifferent) {
      lastIncomingLock.value = `${incomingBaseline.id} 已由 ${incomingBaseline.lockedByClientLabel ?? '其他标签页'} 确认，旧分片按内容哈希对账。`
      lastReconciliation.value = incoming.tasks
        .map((task) => {
          const taskShards = incoming.shards.filter((shard) => shard.taskId === task.id && shard.versionId === incomingBaseline.id)
          return {
            taskId: task.id,
            reused: taskShards.filter((shard) => shard.source !== '本次生成' && shard.status === '已完成').length,
            invalidated: incoming.shards.filter((shard) => shard.taskId === task.id && shard.invalidatedByVersionId === incomingBaseline.id).length,
            recompute: taskShards.filter((shard) => shard.status === '待生成').length,
          }
        })
        .filter((stat) => stat.reused || stat.invalidated || stat.recompute)
    }
  }

  if (typeof window !== 'undefined') window.addEventListener('storage', onExternalState)

  // ---------- 拼版编辑 ----------

  function updatePosition(id: string, patch: Partial<Position>) {
    if (locked.value) return
    const position = positions.value.find((item) => item.id === id)
    if (position) Object.assign(position, patch)
  }

  function addPosition(pageNo: number) {
    if (locked.value || positions.value.some((item) => item.pageNo === pageNo && item.front === (side.value === 'front'))) return
    positions.value.push({ id: `P-${Date.now().toString().slice(-3)}`, pageNo, x: 34, y: 44, rotation: 0, front: side.value === 'front' })
  }

  // ---------- 打样决定 ----------

  function updateProof(id: string, patch: Partial<Proof>) {
    const proof = proofs.value.find((item) => item.id === id)
    if (proof) Object.assign(proof, patch)
  }

  function createProof() {
    const round = proofs.value.length + 1
    proofs.value.push({
      id: `PRF-${String(round).padStart(2, '0')}`,
      round,
      date: new Date().toISOString().slice(0, 10),
      sample: `数字样张 v${round}`,
      deltaE: 0,
      feedback: '',
      correction: '',
      owner: clientLabel.value,
      decision: '待决定',
    })
    selectedProof.value = proofs.value.at(-1)!.id
  }

  // ---------- 版本锁定（生产交接入口） ----------

  function summarizeChanges(): string[] {
    // 与最近一个带快照的版本（锁定基线或刚转历史的版本）对比
    const old = [...versions.value].reverse().find((version) => version.snapshot)
    if (!old) return ['首个生产基线确认']
    const summary: string[] = []
    const oldPositions = new Map(old.snapshot!.positions.map((item) => [item.pageNo, item]))
    positions.value.forEach((position) => {
      const before = oldPositions.get(position.pageNo)
      if (!before) {
        summary.push(`P${position.pageNo} 新增${position.front ? '正' : '反'}面版位`)
        return
      }
      if (before.x !== position.x || before.y !== position.y) summary.push(`P${position.pageNo} 版位移动 (${before.x},${before.y}) → (${position.x},${position.y})`)
      if (before.rotation !== position.rotation) summary.push(`P${position.pageNo} 旋转 ${before.rotation}° → ${position.rotation}°`)
    })
    const oldBleed = new Map((old.snapshot?.pages ?? []).map((page) => [page.pageNo, page.bleed]))
    pages.value.forEach((page) => {
      if (oldBleed.has(page.pageNo) && oldBleed.get(page.pageNo) !== page.bleed) {
        summary.push(`P${page.pageNo} 出血 ${oldBleed.get(page.pageNo)}mm → ${page.bleed}mm`)
      }
    })
    return summary.length ? summary : ['仅元数据调整，版式内容无变化']
  }

  /**
   * 确认基线：先确认者生效；两个标签页同时提交时，后到内容只作冲突留档。
   * otherClient 用于在同一页面演示另一个标签页几乎同时确认的场景。
   */
  function lockBaseline(
    options: { unlockProofId?: string | null; otherClient?: { label: string; lagMs: number } } = {},
  ): LockOutcome | { queued: true } {
    const proofId = options.unlockProofId ?? pendingProof.value?.id ?? proofs.value.at(-1)?.id ?? null
    const proof = proofs.value.find((item) => item.id === proofId)
    if (proof && proof.decision === '待决定') proof.decision = '通过'

    const proposal = {
      clientId: clientId.value,
      clientLabel: clientLabel.value,
      basisRevision: baseline.value?.id ?? versions.value.at(0)?.id ?? 'R0',
      revision: nextVersionId(versions.value),
      unlockProofId: proofId,
      changeSummary: summarizeChanges(),
      pages: structuredClone(pages.value),
      positions: structuredClone(positions.value),
      proofs: structuredClone(proofs.value),
    }

    if (options.otherClient) {
      // 模拟另一标签页先一步确认：对版位做一处不同修订并抢先提交，本提交随即变为后到内容
      const rivalPages = structuredClone(proposal.pages)
      const rivalPositions = structuredClone(proposal.positions).map((position, index) =>
        index === 0 ? { ...position, x: position.x + 12 } : position,
      )
      window.setTimeout(() => {
        commitLock({
          ...proposal,
          clientId: newClientId(),
          clientLabel: options.otherClient!.label,
          revision: nextVersionId(versions.value),
          changeSummary: ['另一标签页的并行修订：P8 右移 12mm'],
          pages: rivalPages,
          positions: rivalPositions,
        })
      }, Math.max(0, options.otherClient.lagMs - 120))
      window.setTimeout(() => commitLock(proposal), options.otherClient.lagMs)
      return { queued: true }
    }
    return commitLock(proposal)
  }

  function commitLock(proposal: BaselineProposal): LockOutcome {
    const now = timestamp()
    const outcome = commitBaseline({
      versions: versions.value,
      pages: proposal.pages,
      positions: proposal.positions,
      proofs: proposal.proofs,
      tasks: tasks.value,
      shards: shards.value,
      proposal,
      now,
      conflictId: `CFL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    })

    if (!outcome.ok) {
      if (outcome.conflict) conflicts.value.unshift(outcome.conflict)
      return outcome
    }
    versions.value = outcome.nextVersions
    tasks.value = outcome.nextTasks
    shards.value = outcome.nextShards
    lastReconciliation.value = outcome.reconciliation
    lastIncomingLock.value = null
    pages.value = structuredClone(proposal.pages)
    positions.value = structuredClone(proposal.positions)
    return outcome
  }

  function unlock() {
    // 解锁修订：锁定基线转为历史，工作区从当前内容继续准备下一个候选版本
    if (baseline.value) baseline.value.status = '历史'
  }

  function dismissIncomingNotice() {
    lastIncomingLock.value = null
  }

  function discardConflict(id: string) {
    conflicts.value = conflicts.value.filter((item) => item.id !== id)
  }

  function restoreConflictContent(id: string) {
    const record = conflicts.value.find((item) => item.id === id)
    if (!record || locked.value) return
    pages.value = structuredClone(record.snapshot.pages)
    positions.value = structuredClone(record.snapshot.positions)
  }

  // ---------- 导出任务：分片写入 / 失败恢复 / 版本对账 ----------

  function shardsOfTask(taskId: string): Shard[] {
    return shards.value
      .filter((shard) => shard.taskId === taskId)
      .sort((a, b) => a.index - b.index)
  }

  function createTask(name = '印刷交付包 · PDF/X-4', kind = '印刷交付包'): ExportTask {
    const now = timestamp()
    const id = `EXP-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`.toUpperCase()
    const task: ExportTask = {
      id,
      name,
      kind,
      versionId: baseline.value?.id ?? versions.value.at(-1)!.id,
      baselineHash: baseline.value?.contentHash ?? draftHash.value,
      status: '排队中',
      progress: 0,
      resumable: true,
      failCount: 0,
      packageHash: null,
      lastCompletedShardId: null,
      lastWriteAt: null,
      createdAt: now,
      updatedAt: now,
    }
    planShards(pages.value).forEach((pageNos, index) => {
      shards.value.push({
        id: `${id}-${task.versionId}-SH-${String(index + 1).padStart(2, '0')}`,
        taskId: id,
        versionId: task.versionId,
        index: index + 1,
        pageNos,
        inputHash: shardInputHash(pages.value, positions.value, pageNos),
        outputHash: null,
        status: '待生成',
        source: '本次生成',
        reusedFromShardId: null,
        invalidatedByVersionId: null,
        attempts: 0,
        lastError: null,
        updatedAt: now,
      })
    })
    tasks.value.unshift(task)
    return task
  }

  /**
   * 模拟导出：从最后完成的分片之后继续写；注入 failWrite=true 时当前分片写入失败，
   * 已完成分片与进度全部保留，任务回到“已中断”，再次恢复时只重写失败分片。
   */
  function runTask(id: string, failWrite = false) {
    const task = tasks.value.find((item) => item.id === id)
    if (!task || task.status === '已完成') return
    task.status = '生成中'
    task.updatedAt = timestamp()
    const runShards = shardsOfTask(id)
    const nextPending = runShards.find((shard) => shard.status !== '已完成')
    if (!nextPending) {
      completeTask(task, runShards)
      return
    }
    window.setTimeout(() => {
      const live = tasks.value.find((item) => item.id === id)
      const shard = shards.value.find((item) => item.id === nextPending.id)
      if (!live || !shard || live.versionId !== shard.versionId) return // 版本切换已让本次运行作废
      shard.attempts += 1
      if (failWrite) {
        shard.status = '生成失败'
        shard.lastError = '写入临时分片失败：磁盘写入中断（模拟）'
        live.status = '已中断'
        live.failCount += 1
        live.updatedAt = timestamp()
        persist()
        return
      }
      shard.outputHash = expectedOutputHash(live.kind, shard.inputHash)
      shard.status = '已完成'
      shard.lastError = null
      shard.updatedAt = timestamp()
      live.lastCompletedShardId = shard.id
      live.lastWriteAt = shard.updatedAt
      const done = shardsOfTask(id).filter((item) => item.status === '已完成').length
      live.progress = Math.round((done / runShards.length) * 100)
      live.updatedAt = timestamp()
      persist()
      if (done === runShards.length) completeTask(live, shardsOfTask(id))
    }, 420)
  }

  /** 故障演练：恢复路径上下一次分片写入失败，验证“从最后完成分片恢复” */
  function simulateWriteFailure(id: string) {
    runTask(id, true)
  }

  function completeTask(task: ExportTask, taskShards: Shard[]) {
    const version = versions.value.find((item) => item.id === task.versionId)
    if (!version) return
    task.status = '已完成'
    task.progress = 100
    task.packageHash = packageManifestHash(version, taskShards)
    task.updatedAt = timestamp()
    persist()
  }

  function resumeTask(id: string) {
    const task = tasks.value.find((item) => item.id === id)
    if (!task || !task.resumable || task.status === '已完成') return
    runTask(id, false)
  }

  return {
    // 状态
    pages,
    positions,
    proofs,
    versions,
    tasks,
    shards,
    conflicts,
    migrations,
    side,
    zoom,
    revision,
    baseline,
    locked,
    dirty,
    draftHash,
    clientId,
    clientLabel,
    selectedPosition,
    selectedProof,
    validations,
    pendingProof,
    currentReuse,
    lastIncomingLock,
    lastReconciliation,
    // 拼版
    updatePosition,
    addPosition,
    // 打样
    updateProof,
    createProof,
    // 版本与交接
    lockBaseline,
    unlock,
    discardConflict,
    restoreConflictContent,
    dismissIncomingNotice,
    summarizeChanges,
    // 导出
    createTask,
    runTask,
    resumeTask,
    simulateWriteFailure,
    shardsOfTask,
    // 工具
    labelTime,
  }
})
