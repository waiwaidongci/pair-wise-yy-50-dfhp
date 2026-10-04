// 旧存档迁移：把 print-imposition-v1 的扁平结构升级为版本化生产结构，
// 全程保留源哈希与目标哈希，迁移结果可审计、可回滚。

import {
  expectedOutputHash,
  hashOf,
  planShards,
  shardInputHash,
  timestamp,
  versionContentHash,
  type ConflictRecord,
  type ExportTask,
  type ImpositionVersion,
  type MigrationRecord,
  type Page,
  type Position,
  type Proof,
  type Shard,
} from './handoff'

export const LEGACY_STORAGE_KEY = 'print-imposition-v1'
export const STORAGE_KEY = 'print-imposition-v2'

interface LegacyPayload {
  pages?: Page[]
  positions?: Position[]
  proofs?: Proof[]
  tasks?: Array<Partial<ExportTask> & { id: string; name: string }>
  revision?: string
  locked?: boolean
}

export interface ProductionState {
  schema: 2
  clientId: string
  clientLabel: string
  pages: Page[]
  positions: Position[]
  proofs: Proof[]
  versions: ImpositionVersion[]
  tasks: ExportTask[]
  shards: Shard[]
  conflicts: ConflictRecord[]
  migrations: MigrationRecord[]
  selectedProofId: string | null
  side: 'front' | 'back'
  zoom: number
  selectedPositionId: string | null
}

// 迁移模块直接复用生产交接的冲突记录类型

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** 读取旧 key 存档并计算源哈希；不存在时返回 null */
export function readLegacy(): { raw: string; data: LegacyPayload; sourceHash: string } | null {
  const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) return null
  let data: LegacyPayload
  try {
    data = JSON.parse(raw) as LegacyPayload
  } catch {
    return null
  }
  return { raw, data, sourceHash: hashOf(raw) }
}

/**
 * 将旧结构迁移到新结构：
 * - 旧 revision/locked 转成首个锁定版本（由最后一轮“通过”的打样解锁，无通过记录则标注待补登）；
 * - 旧任务按 2 页一组分片，已完成进度之前的分片直接落“旧版本迁移”分片并带产物哈希；
 * - 写入迁移记录（源哈希 + 目标哈希）。
 */
export function migrateLegacy(
  legacy: LegacyPayload,
  sourceHash: string,
  seeds: { pages: Page[]; positions: Position[]; proofs: Proof[] },
  now = timestamp(),
  kind: MigrationRecord['kind'] = '本地浏览器存档',
): ProductionState {
  const pages = legacy.pages?.length ? legacy.pages : structuredClone(seeds.pages)
  const positions = legacy.positions?.length ? legacy.positions : structuredClone(seeds.positions)
  const proofs = legacy.proofs?.length ? legacy.proofs : structuredClone(seeds.proofs)
  const revision = legacy.revision ?? 'R5'
  const contentHash = versionContentHash(pages, positions)
  const unlockProof = proofs.find((proof) => proof.decision === '通过') ?? proofs.at(-1) ?? null

  const firstVersion: ImpositionVersion = {
    id: revision,
    parentId: null,
    status: legacy.locked === false ? '候选' : '已锁定',
    contentHash,
    changeSummary: ['旧版拼版存档整体迁移为版本化结构'],
    unlockProofId: unlockProof?.id ?? null,
    lockedByClientId: 'legacy-import',
    lockedByClientLabel: '旧存档迁移',
    createdAt: now,
    lockedAt: legacy.locked === false ? null : now,
    snapshot: { pages: structuredClone(pages), positions: structuredClone(positions) },
  }

  const tasks: ExportTask[] = []
  const shards: Shard[] = []
  const groups = planShards(pages)

  ;(legacy.tasks ?? []).forEach((legacyTask, taskIndex) => {
    const taskId = legacyTask.id ?? `EXP-LEGACY-${taskIndex + 1}`
    const kind = legacyTask.name?.includes('预览') ? '低分辨率预览' : '印刷交付包'
    const progress = typeof legacyTask.progress === 'number' ? legacyTask.progress : 0
    const doneCount = legacyTask.status === '已完成' || progress >= 100 ? groups.length : Math.round((progress / 100) * groups.length)
    const task: ExportTask = {
      id: taskId,
      name: legacyTask.name ?? '迁移任务',
      kind,
      versionId: revision,
      baselineHash: contentHash,
      status: legacyTask.status === '已完成' ? '已完成' : doneCount > 0 ? '已中断' : '排队中',
      progress: legacyTask.status === '已完成' || progress >= 100 ? 100 : Math.round((doneCount / groups.length) * 100),
      resumable: legacyTask.resumable ?? true,
      failCount: 0,
      packageHash: null,
      lastCompletedShardId: null,
      lastWriteAt: progress > 0 ? now : null,
      createdAt: now,
      updatedAt: now,
    }
    groups.forEach((pageNos, index) => {
      const inputHash = shardInputHash(pages, positions, pageNos)
      const done = index < doneCount
      shards.push({
        id: `${taskId}-${revision}-SH-${String(index + 1).padStart(2, '0')}`,
        taskId,
        versionId: revision,
        index: index + 1,
        pageNos,
        inputHash,
        outputHash: done ? expectedOutputHash(kind, inputHash) : null,
        status: done ? '已完成' : '待生成',
        source: '旧版本迁移',
        reusedFromShardId: null,
        invalidatedByVersionId: null,
        attempts: done ? 1 : 0,
        lastError: null,
        updatedAt: now,
      })
    })
    const doneShards = shards.filter((shard) => shard.taskId === taskId && shard.status === '已完成')
    task.lastCompletedShardId = doneShards.at(-1)?.id ?? null
    if (task.status === '已完成' && doneShards.length === groups.length) {
      task.packageHash = hashOf({ taskId, version: revision, shards: doneShards.map((shard) => shard.outputHash) })
    }
    tasks.push(task)
  })

  const state: ProductionState = {
    schema: 2,
    clientId: uid('TAB'),
    clientLabel: '迁移工作区',
    pages,
    positions,
    proofs,
    versions: [firstVersion],
    tasks,
    shards,
    conflicts: [],
    migrations: [],
    selectedProofId: proofs.at(-1)?.id ?? null,
    side: 'front',
    zoom: 72,
    selectedPositionId: null,
  }

  const targetHash = hashOf({
    pages,
    positions,
    proofs,
    versions: state.versions,
    tasks: state.tasks.map((task) => ({ id: task.id, versionId: task.versionId, progress: task.progress })),
  })
  state.migrations.push({
    id: uid('MIG'),
    at: now,
    kind,
    fromSchema: LEGACY_STORAGE_KEY,
    toSchema: STORAGE_KEY,
    sourceHash,
    targetHash,
    taskCount: tasks.length,
    shardCount: shards.length,
  })
  return state
}

/** 无旧存档时，用内置样例构造初始 v2 结构（也留下一条迁移哈希） */
export function seedState(
  seeds: { pages: Page[]; positions: Position[]; proofs: Proof[]; tasks: Array<Partial<ExportTask> & { id: string; name: string }> },
  now = timestamp(),
): ProductionState {
  return migrateLegacy(
    {
      pages: seeds.pages,
      positions: seeds.positions,
      proofs: seeds.proofs,
      tasks: seeds.tasks,
      revision: 'R5',
      locked: true,
    },
    hashOf('builtin-seed-v1'),
    { pages: seeds.pages, positions: seeds.positions, proofs: seeds.proofs },
    now,
    '内置样例升级',
  )
}
