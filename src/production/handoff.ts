// 生产交接领域模型：拼版版本 / 打样决定 / 导出任务
// 纯函数模块，不依赖 Vue 或 Pinia，便于单测与在多个标签页之间复用同一套规则。

export type Page = { pageNo: number; name: string; width: number; height: number; bleed: number; content: string }
export type Position = { id: string; pageNo: number; x: number; y: number; rotation: number; front: boolean }
export type Validation = { id: string; severity: '错误' | '警告'; pageNo?: number; title: string; detail: string }
export type ProofDecision = '待决定' | '通过' | '退回'
export type Proof = {
  id: string
  round: number
  date: string
  sample: string
  deltaE: number
  feedback: string
  correction: string
  owner: string
  decision: ProofDecision
}

export type VersionStatus = '候选' | '已锁定' | '历史'
export type ShardStatus = '待生成' | '已完成' | '作废' | '生成失败'
export type ShardSource = '本次生成' | '复用' | '旧版本迁移'
export type TaskStatus = '排队中' | '生成中' | '已完成' | '已中断'

/** 拼版版本：记录由哪一轮打样决定解锁、父版本与内容哈希 */
export interface ImpositionVersion {
  id: string
  parentId: string | null
  status: VersionStatus
  contentHash: string
  changeSummary: string[]
  unlockProofId: string | null
  lockedByClientId: string | null
  lockedByClientLabel: string | null
  createdAt: string
  lockedAt: string | null
  /** 锁定瞬间的页面/版位快照，供版本对比与后续差异统计 */
  snapshot?: { pages: Page[]; positions: Position[] }
}

/** 导出分片：写入产物、哈希、来源（复用/旧版本迁移）以及作废去向 */
export interface Shard {
  id: string
  taskId: string
  versionId: string
  index: number
  pageNos: number[]
  inputHash: string
  outputHash: string | null
  status: ShardStatus
  source: ShardSource
  reusedFromShardId: string | null
  invalidatedByVersionId: string | null
  attempts: number
  lastError: string | null
  updatedAt: string
}

/** 导出任务：绑定版本内容哈希，记录最后完成分片作为写入断点 */
export interface ExportTask {
  id: string
  name: string
  kind: string
  versionId: string
  baselineHash: string
  status: TaskStatus
  progress: number
  resumable: boolean
  failCount: number
  packageHash: string | null
  lastCompletedShardId: string | null
  lastWriteAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ExportTaskDetail extends ExportTask {
  shards: Shard[]
}

/** 两个标签页同时提交时，后到内容的冲突留档 */
export interface ConflictRecord {
  id: string
  at: string
  basisVersionId: string
  winnerVersionId: string
  winnerClientId: string
  winnerClientLabel: string
  loserClientId: string
  loserClientLabel: string
  loserRevision: string
  reason: string
  contentHash: string
  payloadHash: string
  changeSummary: string[]
  pageCount: number
  positionCount: number
  snapshot: { pages: Page[]; positions: Position[] }
}

/** 旧结构数据迁移留档：留下源哈希与目标哈希 */
export interface MigrationRecord {
  id: string
  at: string
  kind: '本地浏览器存档' | '内置样例升级'
  fromSchema: string
  toSchema: string
  sourceHash: string
  targetHash: string
  taskCount: number
  shardCount: number
}

export interface BaselineProposal {
  clientId: string
  clientLabel: string
  basisRevision: string
  revision: string
  unlockProofId: string | null
  changeSummary: string[]
  pages: Page[]
  positions: Position[]
  proofs: Proof[]
}

export interface ReconcileStat {
  taskId: string
  reused: number
  invalidated: number
  recompute: number
}

export interface LockOutcome {
  ok: boolean
  version?: ImpositionVersion
  conflict?: ConflictRecord
  reconciliation: ReconcileStat[]
  nextVersions: ImpositionVersion[]
  nextTasks: ExportTask[]
  nextShards: Shard[]
}

export const SHARD_PAGE_SIZE = 2
const RENDER_STEP = 'raster-flatten-v1'

// ---------- 哈希工具 ----------

/** cyrb53，输出定长 14 位十六进制；分片输入、产物与交付包统一使用同一算法 */
export function cyrb53(input: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (2097152n * BigInt(h2 >>> 0) + BigInt(h1 >>> 0)).toString(16).padStart(14, '0')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function hashOf(value: unknown): string {
  return cyrb53(stableJson(value))
}

export const shortHash = (hash: string | null | undefined, length = 10): string => (hash ? hash.slice(0, length) : '—')

export function timestamp(): string {
  return new Date().toISOString()
}

export function labelTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

// ---------- 版本与分片内容指纹 ----------

export function versionContentHash(pages: Page[], positions: Position[]): string {
  return hashOf({
    pages: pages
      .map((page) => ({ pageNo: page.pageNo, name: page.name, width: page.width, height: page.height, bleed: page.bleed, content: page.content }))
      .sort((a, b) => a.pageNo - b.pageNo),
    positions: positions
      .map((position) => ({ id: position.id, pageNo: position.pageNo, x: position.x, y: position.y, rotation: position.rotation, front: position.front }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  })
}

export function shardInputHash(pages: Page[], positions: Position[], pageNos: number[]): string {
  const wanted = new Set(pageNos)
  return hashOf({
    pages: pages
      .filter((page) => wanted.has(page.pageNo))
      .map((page) => ({ pageNo: page.pageNo, width: page.width, height: page.height, bleed: page.bleed, content: page.content }))
      .sort((a, b) => a.pageNo - b.pageNo),
    positions: positions
      .filter((position) => wanted.has(position.pageNo))
      .map((position) => ({ pageNo: position.pageNo, x: position.x, y: position.y, rotation: position.rotation, front: position.front }))
      .sort((a, b) => a.pageNo - b.pageNo),
  })
}

/** 产物哈希只取决于渲染步骤、任务类型与分片输入；跨版本内容一致即可复用 */
export function expectedOutputHash(kind: string, inputHash: string): string {
  return hashOf({ render: RENDER_STEP, kind, input: inputHash })
}

export function planShards(pages: Page[], size = SHARD_PAGE_SIZE): number[][] {
  const pageNos = pages.map((page) => page.pageNo).sort((a, b) => a - b)
  const groups: number[][] = []
  for (let i = 0; i < pageNos.length; i += size) groups.push(pageNos.slice(i, i + size))
  return groups
}

export function packageManifestHash(version: ImpositionVersion, shards: Shard[]): string {
  return hashOf({
    package: 'pdf-x4-delivery',
    version: version.id,
    content: version.contentHash,
    unlockProof: version.unlockProofId,
    shards: shards
      .filter((shard) => shard.status === '已完成')
      .map((shard) => ({ index: shard.index, pages: shard.pageNos, output: shard.outputHash }))
      .sort((a, b) => a.index - b.index),
  })
}

// ---------- 新版本锁定后的任务对账 ----------

export interface ReconcileInput {
  task: ExportTask
  newVersion: ImpositionVersion
  pages: Page[]
  positions: Position[]
  pool: Shard[]
  now: string
}

export interface ReconcileResult {
  task: ExportTask
  shards: Shard[]
  reused: number
  invalidated: number
  recompute: number
}

/**
 * 新版本锁定后对账单个旧任务：
 * - 输入哈希一致的分片：复制产物哈希，标记“复用 / 旧版本迁移”，进度保留；
 * - 内容已经变化的旧分片：作废并记下去向版本；
 * - 缺失分片：重新生成；运行中的任务因此回到“已中断”断点。
 */
export function reconcileTask({ task, newVersion, pages, positions, pool, now }: ReconcileInput): ReconcileResult {
  const groups = planShards(pages)
  const nextShards: Shard[] = []
  let reused = 0
  let invalidated = 0

  groups.forEach((pageNos, index) => {
    const shardId = `${task.id}-${newVersion.id}-SH-${String(index + 1).padStart(2, '0')}`
    const inputHash = shardInputHash(pages, positions, pageNos)
    const donor = pool.find(
      (shard) =>
        shard.status === '已完成' &&
        shard.inputHash === inputHash &&
        shard.outputHash === expectedOutputHash(task.kind, inputHash),
    )
    if (donor) {
      reused += 1
      nextShards.push({
        id: shardId,
        taskId: task.id,
        versionId: newVersion.id,
        index: index + 1,
        pageNos,
        inputHash,
        outputHash: donor.outputHash,
        status: '已完成',
        source: donor.taskId === task.id ? '旧版本迁移' : '复用',
        reusedFromShardId: donor.id,
        invalidatedByVersionId: null,
        attempts: donor.attempts,
        lastError: null,
        updatedAt: now,
      })
    } else {
      nextShards.push({
        id: shardId,
        taskId: task.id,
        versionId: newVersion.id,
        index: index + 1,
        pageNos,
        inputHash,
        outputHash: null,
        status: '待生成',
        source: '本次生成',
        reusedFromShardId: null,
        invalidatedByVersionId: null,
        attempts: 0,
        lastError: null,
        updatedAt: now,
      })
    }
  })

  // 该任务在上一版本上的分片：
  // - 输入仍匹配、被新分片继承（产物哈希不同仅因渲染无关）：不算作废；
  // - 内容已经变化、没有任何新分片引用：作废并记下去向版本。
  const inherited = pool.filter((shard) => shard.taskId === task.id && shard.versionId !== newVersion.id)
  inherited.forEach((shard) => {
    const carried = nextShards.some((next) => next.reusedFromShardId === shard.id)
    const stillMatches = nextShards.some((next) => next.inputHash === shard.inputHash)
    if (!carried && !stillMatches && shard.status === '已完成') {
      shard.status = '作废'
      shard.invalidatedByVersionId = newVersion.id
      shard.updatedAt = now
      invalidated += 1
    }
  })

  const recompute = nextShards.filter((shard) => shard.status === '待生成').length
  const progress = Math.round((reused / nextShards.length) * 100)
  const completedOrder = nextShards.filter((shard) => shard.status === '已完成')
  const allReused = recompute === 0
  const reconciled: ExportTask = {
    ...task,
    versionId: newVersion.id,
    baselineHash: newVersion.contentHash,
    progress: allReused ? 100 : progress,
    packageHash: allReused ? packageManifestHash(newVersion, nextShards) : null,
    status: allReused ? '已完成' : '已中断',
    resumable: true,
    lastCompletedShardId: completedOrder.at(-1)?.id ?? null,
    lastWriteAt: completedOrder.length ? now : task.lastWriteAt,
    updatedAt: now,
  }

  return { task: reconciled, shards: nextShards, reused, invalidated, recompute }
}

// ---------- 基线确认 CAS：先确认的生效，后到的留档 ----------

export function nextVersionId(versions: ImpositionVersion[]): string {
  const max = versions.reduce((acc, version) => Math.max(acc, Number(version.id.replace(/^R/, '')) || 0), 0)
  return `R${max + 1}`
}

export function findBaseline(versions: ImpositionVersion[]): ImpositionVersion | null {
  return versions.find((version) => version.status === '已锁定') ?? null
}

export interface CommitContext {
  versions: ImpositionVersion[]
  pages: Page[]
  positions: Position[]
  proofs: Proof[]
  tasks: ExportTask[]
  shards: Shard[]
  proposal: BaselineProposal
  now: string
  conflictId: string
}

/**
 * 以“先确认者胜”的方式提交基线。
 * 只要基线已被其他客户端推进，且后到内容与新基线不同，即判为冲突并留档，不覆盖数据。
 */
export function commitBaseline(context: CommitContext): LockOutcome {
  const { versions, tasks, shards, proposal, now, conflictId } = context
  const baseline = findBaseline(versions)
  const liveHash = versionContentHash(proposal.pages, proposal.positions)
  const reconciliation: ReconcileStat[] = []

  // 先确认者胜：后到提交依据的版本已不是当前锁定基线，即判冲突并留档
  const newerBaseline = baseline && proposal.basisRevision !== baseline.id
  if (newerBaseline) {
    const conflict: ConflictRecord = {
      id: conflictId,
      at: now,
      basisVersionId: proposal.basisRevision,
      winnerVersionId: baseline.id,
      winnerClientId: baseline.lockedByClientId ?? 'unknown',
      winnerClientLabel: baseline.lockedByClientLabel ?? '其他标签页',
      loserClientId: proposal.clientId,
      loserClientLabel: proposal.clientLabel,
      loserRevision: proposal.revision,
      reason: `基线已由 ${baseline.lockedByClientLabel ?? '其他标签页'} 确认为 ${baseline.id}，后到内容仅作冲突留档，未写入生产基线。`,
      contentHash: liveHash,
      payloadHash: hashOf({ pages: proposal.pages, positions: proposal.positions, summary: proposal.changeSummary }),
      changeSummary: proposal.changeSummary,
      pageCount: proposal.pages.length,
      positionCount: proposal.positions.length,
      snapshot: { pages: structuredClone(proposal.pages), positions: structuredClone(proposal.positions) },
    }
    return {
      ok: false,
      conflict,
      reconciliation,
      nextVersions: versions,
      nextTasks: tasks,
      nextShards: shards,
    }
  }

  const locked: ImpositionVersion = {
    id: proposal.revision,
    parentId: baseline?.id ?? null,
    status: '已锁定',
    contentHash: liveHash,
    changeSummary: proposal.changeSummary,
    unlockProofId: proposal.unlockProofId,
    lockedByClientId: proposal.clientId,
    lockedByClientLabel: proposal.clientLabel,
    createdAt: now,
    lockedAt: now,
    snapshot: { pages: structuredClone(proposal.pages), positions: structuredClone(proposal.positions) },
  }

  const nextVersions = versions.map((version) =>
    version.status === '已锁定' || version.status === '候选' ? { ...version, status: '历史' as VersionStatus } : version,
  )
  nextVersions.push(locked)

  // 旧版本上的任务整体对账：旧分片失效重算，可复用进度保留
  const touchedTasks: ExportTask[] = []
  const touchedShards: Shard[] = [...shards]
  tasks
    .filter((task) => task.versionId !== locked.id)
    .forEach((task) => {
      const result = reconcileTask({
        task,
        newVersion: locked,
        pages: proposal.pages,
        positions: proposal.positions,
        pool: touchedShards,
        now,
      })
      result.shards.forEach((shard) => {
        const existing = touchedShards.findIndex((item) => item.id === shard.id)
        if (existing >= 0) touchedShards[existing] = shard
        else touchedShards.push(shard)
      })
      touchedTasks.push(result.task)
      reconciliation.push({ taskId: task.id, reused: result.reused, invalidated: result.invalidated, recompute: result.recompute })
    })

  return {
    ok: true,
    version: locked,
    reconciliation,
    nextVersions,
    nextTasks: mergeTasks(tasks, touchedTasks),
    nextShards: touchedShards,
  }
}

function mergeTasks(tasks: ExportTask[], touched: ExportTask[]): ExportTask[] {
  return tasks.map((task) => touched.find((item) => item.id === task.id) ?? task)
}

/** 预判当前工作区相对已锁定基线会重算/复用哪些分片，用于锁定前的确认说明 */
export function previewReuse(
  pages: Page[],
  positions: Position[],
  tasks: ExportTask[],
  shards: Shard[],
  kind = '印刷交付包',
): { reused: number; recompute: number } {
  const groups = planShards(pages)
  let reused = 0
  groups.forEach((pageNos) => {
    const inputHash = shardInputHash(pages, positions, pageNos)
    const donor = shards.find(
      (shard) => shard.status === '已完成' && shard.inputHash === inputHash && shard.outputHash === expectedOutputHash(kind, inputHash),
    )
    if (donor) reused += 1
  })
  return { reused, recompute: groups.length - reused }
}
