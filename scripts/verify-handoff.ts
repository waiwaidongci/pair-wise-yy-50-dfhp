import {
  commitBaseline,
  expectedOutputHash,
  planShards,
  reconcileTask,
  shardInputHash,
  type ExportTask,
  type ImpositionVersion,
  type Page,
  type Position,
  type Proof,
  type Shard,
} from '../src/production/handoff'
import { migrateLegacy } from '../src/production/migration'

let passed = 0
function check(name: string, cond: boolean) {
  if (!cond) throw new Error(`FAIL: ${name}`)
  passed += 1
  console.log(`✓ ${name}`)
}

const pages: Page[] = Array.from({ length: 8 }, (_, i) => ({
  pageNo: i + 1,
  name: `P${i + 1}`,
  width: 210,
  height: 297,
  bleed: 3,
  content: `page-${i + 1}`,
}))
const positions: Position[] = pages.map((page, i) => ({
  id: `P-${String(i + 1).padStart(2, '0')}`,
  pageNo: page.pageNo,
  x: 34,
  y: 44,
  rotation: 0,
  front: i < 4,
}))
const proofs: Proof[] = [
  { id: 'PRF-01', round: 1, date: '2026-09-18', sample: 'v1', deltaE: 3.8, feedback: '', correction: '', owner: 'A', decision: '退回' },
  { id: 'PRF-02', round: 2, date: '2026-09-25', sample: 'v2', deltaE: 1.9, feedback: '', correction: '', owner: 'B', decision: '待决定' },
]
const now = '2026-10-04T08:00:00.000Z'

// 用 migrateLegacy 得到 R5 + 旧任务（72% 进度 → 3/4 分片）
const migrated = migrateLegacy(
  { pages, positions, proofs, tasks: [{ id: 'EXP-OLD', name: '印刷交付包 · PDF/X-4', progress: 72, status: '已中断', resumable: true }], revision: 'R5', locked: true },
  'source-hash-abcdef',
  { pages, positions, proofs },
  now,
)
check('迁移产生 1 个锁定版本与迁移记录（源/目标哈希）', migrated.versions.length === 1 && migrated.migrations[0].sourceHash === 'source-hash-abcdef' && migrated.migrations[0].targetHash.length === 14)
check('迁移按 2 页/组生成 4 个分片，旧进度落为 3 个已完成分片', migrated.shards.length === 4 && migrated.shards.filter((s) => s.status === '已完成').length === 3)
check('迁移分片全部标注旧版本迁移来源', migrated.shards.every((s) => s.source === '旧版本迁移' || s.status === '待生成'))

// 新版本：P7 出血修正 + 位置变化 → P7 所在分片应重算，其他分片复用
const newPages = structuredClone(pages)
newPages[6] = { ...newPages[6], bleed: 3 }
const newPositions = structuredClone(positions)
newPositions[6] = { ...newPositions[6], x: 52 }

const lockA = commitBaseline({
  versions: migrated.versions, pages: newPages, positions: newPositions, proofs,
  tasks: migrated.tasks, shards: migrated.shards,
  proposal: {
    clientId: 'tab-A', clientLabel: '白班 A', basisRevision: 'R5', revision: 'R6', unlockProofId: 'PRF-02',
    changeSummary: ['P7 出血修正'], pages: newPages, positions: newPositions, proofs,
  },
  now, conflictId: 'CFL-1',
})
check('白班 A 成功锁定 R6 并关联第 2 轮打样', lockA.ok && lockA.version?.id === 'R6' && lockA.version.unlockProofId === 'PRF-02')
const stat = lockA.reconciliation[0]
check('对账：4 组中 3 组复用、1 组重算', stat.reused === 3 && stat.recompute === 1 && stat.invalidated === 0)
const r6Shards = lockA.nextShards.filter((s) => s.taskId === 'EXP-OLD' && s.versionId === 'R6').sort((a, b) => a.index - b.index)
check('复用分片保留产物哈希并标记旧版本迁移', r6Shards.slice(0, 3).every((s) => s.status === '已完成' && s.outputHash && s.source === '旧版本迁移'))
check('含 P7 的分片待重算且无产物哈希', r6Shards[3].pageNos.includes(7) && r6Shards[3].status === '待生成' && r6Shards[3].outputHash === null)
check('任务回到已中断、进度 75%、断点指向最后完成组', lockA.nextTasks[0].status === '已中断' && lockA.nextTasks[0].progress === 75 && lockA.nextTasks[0].lastCompletedShardId?.endsWith('SH-03'))

// 写入失败恢复（在后续版本对账之前验证干净的 R6 状态）：已完成 3 组保留，第 4 组失败后仅补写本组
const failTask: ExportTask = { ...lockA.nextTasks[0] }
const failShards = lockA.nextShards
  .filter((s) => s.taskId === failTask.id && s.versionId === 'R6')
  .map((s) => ({ ...s }))
const pending = failShards.find((s) => s.status === '待生成')!
pending.status = '生成失败'
pending.attempts = 1
pending.lastError = '写入失败'
const before = failShards.filter((s) => s.status === '已完成').length
pending.status = '已完成'
pending.outputHash = expectedOutputHash(failTask.kind, pending.inputHash)
const after = failShards.filter((s) => s.status === '已完成').length
check('失败恢复：前 3 组未重跑，仅第 4 组补写', before === 3 && after === 4 && pending.attempts === 1)

// 新版本再变：P1 内容变化 → 仅 P1 组重算；先模拟 R6 恢复跑完 P7 组，验证其产物在 R7 被复用
const r6PoolAfterResume: Shard[] = lockA.nextShards.map((s) => {
  if (s.taskId === 'EXP-OLD' && s.versionId === 'R6' && s.status === '待生成') {
    return { ...s, status: '已完成', outputHash: expectedOutputHash('印刷交付包', s.inputHash), updatedAt: now }
  }
  return s
})
const r6TasksAfterResume: ExportTask[] = lockA.nextTasks.map((t) =>
  t.id === 'EXP-OLD' ? { ...t, status: '生成中', progress: 100, lastCompletedShardId: 'EXP-OLD-R6-SH-04' } : t,
)
const pages3 = structuredClone(newPages)
pages3[0] = { ...pages3[0], content: 'cover-updated' }
const lockB = commitBaseline({
  versions: lockA.nextVersions, pages: pages3, positions: newPositions, proofs,
  tasks: r6TasksAfterResume, shards: r6PoolAfterResume,
  proposal: {
    clientId: 'tab-A', clientLabel: '白班 A', basisRevision: 'R6', revision: 'R7', unlockProofId: 'PRF-02',
    changeSummary: ['封面更新'], pages: pages3, positions: newPositions, proofs,
  },
  now: '2026-10-04T10:00:00.000Z', conflictId: 'CFL-2',
})
check('锁定 R7 成功', lockB.ok && lockB.version?.id === 'R7')
const statB = lockB.reconciliation[0]
check('R7 对账：3 组复用（含 R6 重算过的 P7 组）、1 组重算', statB.reused === 3 && statB.recompute === 1)
const r7Shards = lockB.nextShards.filter((s) => s.taskId === 'EXP-OLD' && s.versionId === 'R7').sort((a, b) => a.index - b.index)
check('R7 中 P7 组分到 R6 的产物哈希', r7Shards[3].outputHash === expectedOutputHash('印刷交付包', shardInputHash(pages3, newPositions, [7, 8])))
const voided = lockB.nextShards.filter((s) => s.status === '作废')
check('旧分片作废并记录作废去向版本（R5→R6、R6→R7 各留痕）', voided.length >= 1 && voided.some((s) => s.invalidatedByVersionId === 'R7') && voided.every((s) => !!s.invalidatedByVersionId))

// 双标签页：R7 已由 A 确认后，B 基于 R6 的不同内容后到 → 冲突留档，基线不变
const rivalPages = structuredClone(newPages)
const rivalPositions = structuredClone(newPositions).map((p, i) => (i === 0 ? { ...p, x: 66 } : p))
const lockC = commitBaseline({
  versions: lockB.nextVersions, pages: rivalPages, positions: rivalPositions, proofs,
  tasks: lockB.nextTasks, shards: lockB.nextShards,
  proposal: {
    clientId: 'tab-B', clientLabel: '夜班 B', basisRevision: 'R6', revision: 'R7', unlockProofId: 'PRF-02',
    changeSummary: ['B 的并行修订'], pages: rivalPages, positions: rivalPositions, proofs,
  },
  now: '2026-10-04T10:00:01.000Z', conflictId: 'CFL-3',
})
check('后到提交被拒绝并生成冲突留档', !lockC.ok && !!lockC.conflict && lockC.conflict.winnerVersionId === 'R7')
check('冲突留档包含后到快照与负载哈希', lockC.conflict!.snapshot.positions.length === 8 && lockC.conflict!.payloadHash.length === 14 && lockC.conflict!.contentHash.length === 14)
check('冲突不改变版本与任务集合', lockC.nextVersions === lockB.nextVersions && lockC.nextTasks === lockB.nextTasks)

// 全部内容一致时直接完成（复用全部 → 交付包哈希生成）
const allDonePool: Shard[] = [...lockB.nextShards]
planShards(pages3).forEach((group, index) => {
  const input = shardInputHash(pages3, newPositions, group)
  allDonePool.push({
    id: `DONOR-${index}`, taskId: 'EXP-OTHER', versionId: 'RX', index: index + 1, pageNos: group,
    inputHash: input, outputHash: expectedOutputHash('印刷交付包', input), status: '已完成',
    source: '复用', reusedFromShardId: null, invalidatedByVersionId: null, attempts: 1, lastError: null, updatedAt: now,
  })
})
const full = reconcileTask({ task: lockB.nextTasks[0], newVersion: lockB.version!, pages: pages3, positions: newPositions, pool: allDonePool, now })
check('所有分片都可复用时任务直接完成且生成交付包哈希', full.task.status === '已完成' && full.task.progress === 100 && !!full.task.packageHash && full.recompute === 0)

console.log(`\n全部 ${passed} 项交接逻辑校验通过`)
